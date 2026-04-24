"""Background episode ingest: FFmpeg audio extract + thumbnails + ASR.

Pipeline produces 16 kHz mono PCM WAV for ASR and diarization.
All media stays on disk (file paths stored in SQLite, never blobs).
Intermediate WAV is cleaned up after transcript extraction on success.
"""

from __future__ import annotations

import logging
import os
try:
    import resource as _resource
except ImportError:
    _resource = None  # type: ignore[assignment]
import subprocess
import threading
import time
from pathlib import Path

from db.store import store
from services import azure_vi_config
from services.azure_vi_diag import azure_vi_line
from services.azure_vi_errors import brief_exception_for_fallback
from services.import_policy import (
    episode_media_max_wall_sec,
    local_first_max_duration_sec,
    max_concurrent_jobs,
    max_media_duration_sec,
)
from services.import_timing import ImportStageTimer
from services.job_timing import (
    job_timing_add_phase,
    job_timing_discard,
    job_timing_log_summary,
)
from services.asr_whisper import transcribe_wav_to_records
from services.diarize import assign_speaker_labels
from services.transcript_text_normalize import (
    apply_transcript_language_policy,
    drop_obvious_hindi_junk_segments,
    normalize_video_indexer_language,
)
from services.ffmpeg_bin import get_ffmpeg_paths
from services.r2_storage import (
    artifacts_bucket,
    bucket_for_key,
    r2_configured,
    upload_file as r2_upload_file,
    uploads_bucket,
)
from storage_paths import STORAGE_ROOT, to_rel_storage_path

logger = logging.getLogger(__name__)

_THUMB_COUNT = 6

_job_semaphore: threading.Semaphore | None = None
_semaphore_lock = threading.Lock()


def _get_semaphore() -> threading.Semaphore:
    global _job_semaphore
    if _job_semaphore is None:
        with _semaphore_lock:
            if _job_semaphore is None:
                _job_semaphore = threading.Semaphore(max_concurrent_jobs())
                logger.info(
                    "episode_media concurrency limit=%d",
                    max_concurrent_jobs(),
                )
    return _job_semaphore


def _rss_mb() -> float:
    """Current process RSS in MB (Linux/macOS). Returns 0 on Windows."""
    if _resource is None:
        return 0.0
    try:
        ru = _resource.getrusage(_resource.RUSAGE_SELF)
        return ru.ru_maxrss / 1024.0
    except Exception:
        return 0.0


def _file_size_mb(p: Path) -> float:
    try:
        return p.stat().st_size / (1024 * 1024)
    except OSError:
        return 0.0


def _log_stage(job_id: str, stage: str, **extra: object) -> None:
    parts = " ".join(f"{k}={v}" for k, v in extra.items())
    logger.info(
        "castweave_stage job_id=%s stage=%s rss_mb=%.1f %s",
        job_id,
        stage,
        _rss_mb(),
        parts,
    )


def _asr_diag_enabled() -> bool:
    return (os.environ.get("CASTWEAVE_ASR_DIAG") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _fail_episode_job(job_id: str, episode_id: str, message: str) -> None:
    msg = (message or "Processing failed").strip()[:500]
    updated = store.update_job(
        job_id,
        status="failed",
        progress=0.0,
        message=msg,
    )
    if updated is None:
        logger.error(
            "episode_media job_id=%s could not write failed status (job missing?)",
            job_id,
        )
    else:
        logger.warning("episode_media terminal job_id=%s status=failed msg=%s", job_id, msg)
    job_timing_discard(job_id)
    store.update_episode(episode_id, status="failed")


def _safe_unlink(p: Path) -> None:
    try:
        if p.is_file():
            p.unlink()
            logger.debug("cleaned up temp file: %s", p)
    except OSError:
        pass


def schedule_episode_processing(
    job_id: str,
    episode_id: str,
    project_id: str,
    source_path: Path,
) -> None:
    sem = _get_semaphore()

    def _run() -> None:
        acquired = sem.acquire(timeout=5)
        if not acquired:
            _fail_episode_job(
                job_id,
                episode_id,
                "Server is busy processing another import. Please wait and try again.",
            )
            return
        try:
            _run_episode_media_pipeline(job_id, episode_id, project_id, source_path)
        except Exception as exc:
            logger.exception(
                "episode_media job_id=%s episode_id=%s pipeline exception",
                job_id,
                episode_id,
            )
            _fail_episode_job(job_id, episode_id, str(exc))
        finally:
            sem.release()

    threading.Thread(target=_run, daemon=True).start()


def _ffprobe_duration_seconds(video: Path, ffprobe_exe: str) -> float | None:
    r = subprocess.run(
        [
            ffprobe_exe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        return None
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def _ffmpeg_extract_wav(
    video: Path,
    wav_out: Path,
    ffmpeg_exe: str,
    ffprobe_exe: str,
) -> None:
    """Extract audio from video to 16 kHz mono PCM WAV (minimal size for ASR)."""
    r = subprocess.run(
        [
            ffmpeg_exe,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(wav_out),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode == 0:
        return

    err = (r.stderr or r.stdout or "").strip() or "ffmpeg failed"
    low = err.lower()
    if (
        "does not contain any stream" in low
        or "no audio" in low
        or "missing audio" in low
        or "output file #0 does not contain any stream" in low
    ):
        duration = _ffprobe_duration_seconds(video, ffprobe_exe) or 1.0
        r2 = subprocess.run(
            [
                ffmpeg_exe,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=16000:cl=mono",
                "-t",
                str(max(0.1, duration)),
                "-acodec",
                "pcm_s16le",
                str(wav_out),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if r2.returncode == 0:
            logger.info(
                "Video has no audio; wrote silent WAV (%.2fs) for %s",
                duration,
                video.name,
            )
            return
        err2 = (r2.stderr or r2.stdout or "").strip() or err
        raise RuntimeError(f"Silent WAV fallback failed: {err2}")

    raise RuntimeError(f"Audio extract failed: {err}")


def _ffmpeg_normalize_audio(
    audio_in: Path,
    wav_out: Path,
    ffmpeg_exe: str,
) -> None:
    """Normalize an audio file (mp3, m4a, etc.) to 16 kHz mono PCM WAV."""
    r = subprocess.run(
        [
            ffmpeg_exe,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(audio_in),
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(wav_out),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip() or "ffmpeg audio normalize failed"
        raise RuntimeError(f"Audio normalization failed: {err}")


def _ffmpeg_thumbnail(
    video: Path,
    timestamp_sec: float,
    jpg_out: Path,
    ffmpeg_exe: str,
) -> None:
    r = subprocess.run(
        [
            ffmpeg_exe,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            str(max(0.0, timestamp_sec)),
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(jpg_out),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip() or "ffmpeg failed"
        raise RuntimeError(f"Thumbnail failed: {err}")


def _run_episode_media_pipeline(
    job_id: str,
    episode_id: str,
    project_id: str,
    source_path: Path,
) -> None:
    timer = ImportStageTimer(job_id)
    wall_deadline = time.monotonic() + episode_media_max_wall_sec()
    wav_path: Path | None = None

    def _enforce_deadline(where: str) -> None:
        if time.monotonic() > wall_deadline:
            raise RuntimeError(
                f"Processing timed out during: {where}. "
                "Try a shorter clip, or check API logs and CASTWEAVE_EPISODE_MEDIA_MAX_SEC."
            )

    _log_stage(job_id, "pipeline_start", source_mb=_file_size_mb(source_path))
    timer.mark("pipeline_worker_start")

    ffmpeg_exe, ffprobe_exe = get_ffmpeg_paths()
    if not source_path.is_file():
        raise RuntimeError("Source media missing after upload")

    ep_row = store.get_episode(episode_id)
    is_audio_only = (ep_row.media_type == "audio") if ep_row else False

    store.update_job(
        job_id,
        status="running",
        progress=0.08,
        message="Reading your audio..." if is_audio_only else "Reading your video...",
    )

    # --- Probe duration and enforce limit ---
    t_extract0 = time.perf_counter()
    duration = _ffprobe_duration_seconds(source_path, ffprobe_exe)
    timer.mark("ffprobe_done")
    _log_stage(job_id, "ffprobe_done", duration_sec=duration or 0)
    _enforce_deadline("after_probe")

    dur_limit = max_media_duration_sec()
    if duration is not None and duration > dur_limit:
        raise RuntimeError(
            f"Media is too long ({int(duration)}s). "
            f"Maximum allowed duration is {int(dur_limit)}s ({int(dur_limit // 60)} minutes). "
            "Please trim the file and re-upload."
        )

    source_rel = to_rel_storage_path(source_path)
    store.update_episode(
        episode_id,
        source_video_rel=source_rel,
        duration_sec=duration,
    )

    # --- Extract audio to 16 kHz mono WAV ---
    wav_path = source_path.parent / "audio.wav"
    store.update_job(job_id, progress=0.22, message="Extracting audio...")
    if is_audio_only:
        _ffmpeg_normalize_audio(source_path, wav_path, ffmpeg_exe)
    else:
        _ffmpeg_extract_wav(source_path, wav_path, ffmpeg_exe, ffprobe_exe)
    audio_rel = to_rel_storage_path(wav_path)
    store.update_episode(episode_id, extracted_audio_rel=audio_rel)
    job_timing_add_phase(job_id, "extract", time.perf_counter() - t_extract0)
    timer.mark("audio_extract_done")
    _log_stage(job_id, "audio_extract_done", wav_mb=_file_size_mb(wav_path))
    _enforce_deadline("after_audio_extract")

    # --- Thumbnails ---
    thumb_rels: list[str] = []
    if is_audio_only:
        store.update_job(job_id, progress=0.45, message="Audio-only import -- skipping frames.")
        store.update_episode(episode_id, thumbnail_rels=[])
        timer.mark("thumbnails_skipped")
    else:
        store.update_job(job_id, progress=0.45, message="Saving preview frames...")
        t_th0 = time.perf_counter()
        if duration and duration > 0:
            for i in range(_THUMB_COUNT):
                t = (i + 0.5) * duration / _THUMB_COUNT
                out = source_path.parent / f"thumb_{i + 1:02d}.jpg"
                _ffmpeg_thumbnail(source_path, t, out, ffmpeg_exe)
                thumb_rels.append(to_rel_storage_path(out))
        else:
            for i in range(_THUMB_COUNT):
                out = source_path.parent / f"thumb_{i + 1:02d}.jpg"
                _ffmpeg_thumbnail(source_path, float(i), out, ffmpeg_exe)
                thumb_rels.append(to_rel_storage_path(out))

        store.update_episode(episode_id, thumbnail_rels=thumb_rels)
        job_timing_add_phase(job_id, "thumbnails", time.perf_counter() - t_th0)
        timer.mark("thumbnails_done")
    _log_stage(job_id, "thumbnails_done")
    _enforce_deadline("after_thumbnails")

    # --- Transcript (remote or local) ---
    wav_abs = (STORAGE_ROOT / audio_rel).resolve()
    language: str | None = None
    t_segments: list = []
    import_provider = "local"
    fallback_reason: str | None = None
    asr_diag: dict = {}

    local_first_lim = local_first_max_duration_sec()
    prefer_local_hindi = (
        os.environ.get("CASTWEAVE_HINDI_PREFER_LOCAL", "").strip().lower()
        in ("1", "true", "yes")
    )
    skip_remote = (
        local_first_lim is not None
        and duration is not None
        and duration > 0
        and duration <= local_first_lim
        and azure_vi_config.azure_video_indexer_configured()
    )
    remote_attempted = False

    if is_audio_only:
        fallback_reason = "Audio-only import -- using on-device transcription."
        logger.info("episode_media job_id=%s audio_only=true skip_remote=true", job_id)
    elif not azure_vi_config.azure_video_indexer_configured():
        fallback_reason = (
            "AI video analysis is not configured on this machine; "
            "using on-device speech and transcript instead."
        )
        logger.info("episode_media job_id=%s %s", job_id, azure_vi_config.startup_log_line())
    elif prefer_local_hindi:
        fallback_reason = "Using on-device analysis because CASTWEAVE_HINDI_PREFER_LOCAL is set."
        logger.info("castweave_hindi step=prefer_local_env job_id=%s skip_remote=true", job_id)
        store.update_job(job_id, progress=0.52, message="Using on-device analysis for better Hindi quality...")
    elif skip_remote:
        fallback_reason = "Using on-device analysis for this shorter clip so the import finishes sooner."
        logger.info(
            "episode_media job_id=%s local_first_skip_remote duration_sec=%.2f max_sec=%s",
            job_id,
            duration,
            local_first_lim,
        )
        store.update_job(job_id, progress=0.52, message="Using on-device analysis for this clip...")
    else:
        remote_attempted = True
        try:
            from services.video_indexer_service import index_local_file_for_episode

            logger.info(
                "episode_media job_id=%s episode_id=%s attempting remote AI video analysis path",
                job_id,
                episode_id,
            )
            azure_vi_line(
                "worker: entering index_local_file_for_episode job_id=%s episode_id=%s",
                job_id,
                episode_id,
            )
            timer.mark("remote_analysis_start")
            _log_stage(job_id, "remote_analysis_start")
            t_remote_wall = time.perf_counter()
            _enforce_deadline("before_remote_analysis")
            vi_lang, vi_segments = index_local_file_for_episode(
                source_path,
                episode_id,
                video_name=f"{episode_id}-{source_path.name}"[:80],
                job_id=job_id,
            )
            job_timing_add_phase(job_id, "remote_analysis", time.perf_counter() - t_remote_wall)
            timer.mark("remote_analysis_done")
            _log_stage(job_id, "remote_analysis_done", sec=round(time.perf_counter() - t_remote_wall, 2))
            _enforce_deadline("after_remote_analysis")
            if vi_segments and len(vi_segments) > 0:
                language = vi_lang
                t_segments = vi_segments
                import_provider = "azure_video_indexer"
                fallback_reason = None
                logger.info(
                    "episode_media remote transcript job_id=%s episode_id=%s segments=%s",
                    job_id,
                    episode_id,
                    len(t_segments),
                )
            else:
                fallback_reason = (
                    "Cloud analysis returned no usable transcript; "
                    "switching to on-device transcription."
                )
                logger.warning("episode_media job_id=%s %s", job_id, fallback_reason)
        except Exception as e:
            fallback_reason = brief_exception_for_fallback(e)
            logger.warning(
                "episode_media job_id=%s remote analysis failed; fallback_reason=%s",
                job_id,
                fallback_reason,
                exc_info=True,
            )
            azure_vi_line(
                "worker: remote analysis exception: %s (local fallback if needed)",
                fallback_reason,
            )
            try:
                store.update_job(
                    job_id,
                    message=(
                        "Cloud analysis hit a snag. Continuing on this device "
                        "so you can still finish the import."
                    )[:500],
                )
            except Exception:
                logger.warning(
                    "episode_media job_id=%s could not update job after remote failure",
                    job_id,
                    exc_info=True,
                )

    if not t_segments:
        t_local0 = time.perf_counter()
        store.update_job(job_id, progress=0.62, message="Transcribing on this device...")
        _log_stage(job_id, "local_transcribe_start")
        timer.mark("local_transcribe_start")
        _enforce_deadline("before_local_transcribe")
        try:
            language, t_segments, asr_diag = transcribe_wav_to_records(wav_abs, episode_id)
        except Exception as e:
            logger.exception("transcription failed episode_id=%s", episode_id)
            raise RuntimeError(f"Transcription failed: {e}") from e

        timer.mark("local_transcribe_done")
        _log_stage(
            job_id,
            "local_transcribe_done",
            segments=len(t_segments),
            language=language,
        )
        _enforce_deadline("after_local_transcribe")
        logger.info(
            "transcription model done job_id=%s episode_id=%s segments=%s language=%s coverage=%.3f low=%s retry=%s",
            job_id,
            episode_id,
            len(t_segments),
            language,
            float(asr_diag.get("coverage_ratio") or 0),
            bool(asr_diag.get("low_coverage")),
            bool(asr_diag.get("retry_triggered")),
        )

        store.update_job(job_id, progress=0.78, message="Detecting speakers...")
        timer.mark("diarize_start")
        _log_stage(job_id, "diarize_start")
        try:
            t_segments = assign_speaker_labels(wav_abs, t_segments)
            logger.info("diarization done job_id=%s episode_id=%s", job_id, episode_id)
        except Exception as e:
            logger.warning("diarization failed (non-fatal) episode_id=%s: %s", episode_id, e)
        timer.mark("diarize_done")
        _log_stage(job_id, "diarize_done")
        dt_local = time.perf_counter() - t_local0
        if remote_attempted:
            job_timing_add_phase(job_id, "fallback", dt_local)
        else:
            job_timing_add_phase(job_id, "analysis", dt_local)

    # --- Clean up extracted WAV (transcript is persisted, WAV no longer needed) ---
    if wav_path and wav_path.is_file():
        _safe_unlink(wav_path)
        _log_stage(job_id, "wav_cleaned")

    # --- Upload to R2 and clean local ---
    if r2_configured():
        _log_stage(job_id, "r2_upload_start")
        try:
            r2_upload_file(source_path, bucket_for_key(source_rel), source_rel)
            _log_stage(job_id, "r2_source_uploaded", key=source_rel)

            for trel in thumb_rels:
                local_thumb = STORAGE_ROOT / trel
                if local_thumb.is_file():
                    r2_upload_file(local_thumb, bucket_for_key(trel), trel)

            _log_stage(job_id, "r2_thumbs_uploaded", count=len(thumb_rels))

            _safe_unlink(source_path)
            for trel in thumb_rels:
                _safe_unlink(STORAGE_ROOT / trel)

            _log_stage(job_id, "r2_local_cleaned")
        except Exception as exc:
            logger.warning(
                "R2 upload failed job_id=%s (local files kept): %s", job_id, exc
            )

    # --- Persist transcript and finalize ---
    try:
        store.update_job(
            job_id,
            progress=0.88,
            message="Building transcript and cast candidates...",
        )
        timer.mark("persist_start")
        _enforce_deadline("before_persist")
        t_persist0 = time.perf_counter()
        lang_from_whisper = language
        language = normalize_video_indexer_language(language)
        logger.info(
            "episode_media job_id=%s episode_id=%s normalized_language=%s import_provider=%s",
            job_id,
            episode_id,
            language,
            import_provider,
        )
        raw_asr_preview = [(s.text or "")[:220] for s in t_segments[:10]]
        t_segments = apply_transcript_language_policy(language, t_segments)
        t_segments = drop_obvious_hindi_junk_segments(language, t_segments)
        final_display_preview = [(s.text or "")[:220] for s in t_segments[:10]]
        if _asr_diag_enabled():
            logger.info(
                "castweave_asr_diag episode_id=%s job_id=%s whisper_lang=%r "
                "transcript_language_stored=%r detected=%r prob=%r override=%r "
                "roman_hindi_score=%r roman_hindi_hits=%r forced_hindi=%r low_coverage=%r "
                "raw_asr_first10=%s display_first10=%s",
                episode_id,
                job_id,
                lang_from_whisper,
                language,
                asr_diag.get("detected_language"),
                asr_diag.get("detected_probability"),
                asr_diag.get("language_override"),
                asr_diag.get("roman_hindi_hint_score"),
                asr_diag.get("roman_hindi_hint_hits"),
                asr_diag.get("forced_hindi"),
                asr_diag.get("low_coverage"),
                raw_asr_preview,
                final_display_preview,
            )
        store.set_transcript_for_episode(episode_id, t_segments, language=language)
        logger.info(
            "episode_media job_id=%s transcript rows=%s language=%s",
            job_id,
            len(t_segments),
            language,
        )
        job_timing_add_phase(job_id, "persist", time.perf_counter() - t_persist0)

        t_group0 = time.perf_counter()
        store.build_speaker_groups(episode_id)
        logger.info("episode_media job_id=%s speaker groups built", job_id)
        job_timing_add_phase(job_id, "grouping", time.perf_counter() - t_group0)

        t_fin0 = time.perf_counter()
        store.update_episode(
            episode_id,
            status="ready",
            transcript_language=language,
        )
        timer.mark("persist_done")

        speaker_count = len(store.list_speaker_groups(episode_id))
        result = {
            "episode_id": episode_id,
            "project_id": project_id,
            "source_video_path": source_rel,
            "extracted_audio_path": audio_rel,
            "thumbnail_paths": thumb_rels,
            "duration_sec": duration,
            "transcript_segment_count": len(t_segments),
            "transcript_language": language,
            "speaker_count": speaker_count,
            "import_provider": import_provider,
            "fallback_reason": fallback_reason,
            "transcript_coverage_low": bool(asr_diag.get("low_coverage")),
            "transcript_coverage_ratio": float(asr_diag.get("coverage_ratio") or 0.0),
        }
        done = store.update_job(
            job_id,
            status="done",
            progress=1.0,
            message="Processing complete",
            result=result,
        )
        job_timing_add_phase(job_id, "persist", time.perf_counter() - t_fin0)
        total_sec = timer.total_sec()
        _log_stage(job_id, "PIPELINE_COMPLETE", total_sec=round(total_sec, 2))
        job_timing_log_summary(job_id)
        if done is None:
            logger.error(
                "episode_media job_id=%s update_job(done) failed (job row missing)",
                job_id,
            )
        else:
            logger.info(
                "episode_media terminal job_id=%s status=done segments=%s provider=%s",
                job_id,
                len(t_segments),
                import_provider,
            )
    except Exception as exc:
        logger.exception(
            "episode_media job_id=%s finalize failed (transcript / speaker groups / job done)",
            job_id,
        )
        _fail_episode_job(job_id, episode_id, str(exc))
