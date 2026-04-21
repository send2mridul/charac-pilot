"""Background episode ingest: FFmpeg audio extract + thumbnails (local dev)."""

from __future__ import annotations

import logging
import subprocess
import threading
from pathlib import Path

from db.store import store
from services import azure_vi_config
from services.azure_vi_diag import azure_vi_line
from services.azure_vi_errors import brief_exception_for_fallback
from services.asr_whisper import transcribe_wav_to_records
from services.diarize import assign_speaker_labels
from services.ffmpeg_bin import get_ffmpeg_paths
from storage_paths import STORAGE_ROOT, to_rel_storage_path

logger = logging.getLogger(__name__)

_THUMB_COUNT = 6


def _fail_episode_job(job_id: str, episode_id: str, message: str) -> None:
    """Always persist a terminal failed state when the pipeline cannot complete."""
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
    store.update_episode(episode_id, status="failed")


def schedule_episode_processing(
    job_id: str,
    episode_id: str,
    project_id: str,
    source_path: Path,
) -> None:
    def _run() -> None:
        try:
            _run_episode_media_pipeline(job_id, episode_id, project_id, source_path)
        except Exception as exc:
            logger.exception(
                "episode_media job_id=%s episode_id=%s pipeline exception",
                job_id,
                episode_id,
            )
            _fail_episode_job(job_id, episode_id, str(exc))

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
            "44100",
            "-ac",
            "2",
            str(wav_out),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode == 0:
        return

    err = (r.stderr or r.stdout or "").strip() or "ffmpeg failed"
    # Video-only sources have no audio stream — generate silent WAV for the clip duration.
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
                f"anullsrc=r=44100:cl=stereo",
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
    logger.info(
        "episode_media pipeline start job_id=%s episode_id=%s project_id=%s path=%s",
        job_id,
        episode_id,
        project_id,
        source_path.name,
    )
    ffmpeg_exe, ffprobe_exe = get_ffmpeg_paths()
    logger.info(
        "episode_media job_id=%s using ffmpeg=%s ffprobe=%s",
        job_id,
        ffmpeg_exe,
        ffprobe_exe,
    )
    if not source_path.is_file():
        raise RuntimeError("Source video missing after upload")

    store.update_job(
        job_id,
        status="running",
        progress=0.08,
        message="Reading media…",
    )

    duration = _ffprobe_duration_seconds(source_path, ffprobe_exe)
    source_rel = to_rel_storage_path(source_path)

    store.update_episode(
        episode_id,
        source_video_rel=source_rel,
        duration_sec=duration,
    )

    wav_path = source_path.parent / "audio.wav"
    store.update_job(job_id, progress=0.22, message="Extracting audio (WAV)…")
    _ffmpeg_extract_wav(source_path, wav_path, ffmpeg_exe, ffprobe_exe)
    audio_rel = to_rel_storage_path(wav_path)
    store.update_episode(episode_id, extracted_audio_rel=audio_rel)

    store.update_job(job_id, progress=0.45, message="Generating thumbnails…")
    thumb_rels: list[str] = []
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

    wav_abs = (STORAGE_ROOT / audio_rel).resolve()
    language: str | None = None
    t_segments: list = []
    import_provider = "local"
    fallback_reason: str | None = None

    if not azure_vi_config.azure_video_indexer_configured():
        missing = azure_vi_config.missing_required_env_keys()
        fallback_reason = (
            "Azure Video Indexer not configured; missing env: " + ", ".join(missing)
        )
        logger.info(
            "episode_media job_id=%s %s",
            job_id,
            azure_vi_config.startup_log_line(),
        )
    else:
        try:
            from services.video_indexer_service import index_local_file_for_episode

            logger.info(
                "episode_media job_id=%s episode_id=%s attempting Azure VI import path",
                job_id,
                episode_id,
            )
            azure_vi_line(
                "worker: entering index_local_file_for_episode job_id=%s episode_id=%s",
                job_id,
                episode_id,
            )
            print(
                "[characpilot] episode_media: Azure branch — next logs are Azure VI steps",
                flush=True,
            )
            vi_lang, vi_segments = index_local_file_for_episode(
                source_path,
                episode_id,
                video_name=f"{episode_id}-{source_path.name}"[:80],
                job_id=job_id,
            )
            if vi_segments and len(vi_segments) > 0:
                language = vi_lang
                t_segments = vi_segments
                import_provider = "azure_video_indexer"
                fallback_reason = None
                logger.info(
                    "episode_media azure_vi transcript job_id=%s episode_id=%s segments=%s",
                    job_id,
                    episode_id,
                    len(t_segments),
                )
            else:
                fallback_reason = (
                    "Azure Video Indexer returned no transcript segments after mapping "
                    "(check language, audio, or insights in Azure portal)"
                )
                logger.warning(
                    "episode_media job_id=%s %s",
                    job_id,
                    fallback_reason,
                )
        except Exception as e:
            fallback_reason = brief_exception_for_fallback(e)
            logger.warning(
                "episode_media job_id=%s Azure VI path failed; fallback_reason=%s",
                job_id,
                fallback_reason,
                exc_info=True,
            )
            azure_vi_line(
                "worker: Azure path exception — %s (local fallback if needed)",
                fallback_reason,
            )
            try:
                store.update_job(
                    job_id,
                    message=(
                        f"Azure VI failed: {fallback_reason[:350]} — "
                        "continuing with local transcription…"
                    )[:500],
                )
            except Exception:
                logger.warning(
                    "episode_media job_id=%s could not update job after Azure failure",
                    job_id,
                    exc_info=True,
                )

    if not t_segments:
        store.update_job(
            job_id,
            progress=0.62,
            message="Transcribing locally (fallback)…",
        )
        logger.info(
            "transcription start job_id=%s episode_id=%s wav=%s",
            job_id,
            episode_id,
            wav_abs,
        )
        try:
            language, t_segments = transcribe_wav_to_records(wav_abs, episode_id)
        except Exception as e:
            logger.exception("transcription failed episode_id=%s", episode_id)
            raise RuntimeError(
                f"Transcription failed: {e}",
            ) from e

        logger.info(
            "transcription model done job_id=%s episode_id=%s segments=%s language=%s",
            job_id,
            episode_id,
            len(t_segments),
            language,
        )

        store.update_job(
            job_id,
            progress=0.78,
            message="Grouping detected speakers locally…",
        )
        try:
            t_segments = assign_speaker_labels(wav_abs, t_segments)
            logger.info(
                "diarization done job_id=%s episode_id=%s",
                job_id,
                episode_id,
            )
        except Exception as e:
            logger.warning(
                "diarization failed (non-fatal) episode_id=%s: %s", episode_id, e,
            )

    try:
        store.set_transcript_for_episode(episode_id, t_segments, language=language)
        logger.info(
            "episode_media job_id=%s transcript rows=%s",
            job_id,
            len(t_segments),
        )
        store.build_speaker_groups(episode_id)
        logger.info("episode_media job_id=%s speaker groups built", job_id)
        store.update_episode(
            episode_id,
            status="ready",
            transcript_language=language,
        )

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
        }
        done = store.update_job(
            job_id,
            status="done",
            progress=1.0,
            message="Processing complete",
            result=result,
        )
        if done is None:
            logger.error(
                "episode_media job_id=%s update_job(done) failed — job row missing",
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
