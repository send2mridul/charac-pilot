import logging
import os
import subprocess
import tempfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from starlette.background import BackgroundTask

from db.store import store
from schemas.character import CharacterOut, CreateCharacterFromGroupBody
from schemas.episode import EpisodeExportBody
from schemas.job import JobOut
from schemas.replacement import GenerateTakesBody, PatchReplacementBody, ReplaceSegmentBody, ReplacementOut
from schemas.speaker_group import SpeakerGroupMergeBody, SpeakerGroupOut, SpeakerGroupRenameBody
from schemas.transcript import PatchTranscriptSegmentBody, TranscriptOut, TranscriptSegmentOut
from services import character_service, episode_service, episode_transcript_service, job_service
from services import replacement_service

router = APIRouter()
log = logging.getLogger("characpilot.episodes")


def _cleanup_episode_files(project_id: str, episode_id: str) -> None:
    """Remove upload directory for an episode after DB rows are deleted."""
    import shutil
    from storage_paths import UPLOADS_ROOT

    episode_dir = UPLOADS_ROOT / project_id / episode_id
    if episode_dir.is_dir():
        try:
            shutil.rmtree(episode_dir)
            log.info("cleaned up episode dir: %s", episode_dir)
        except OSError as e:
            log.warning("could not clean episode dir %s: %s", episode_dir, e)


def _episode_id(episode_id: str) -> str:
    return episode_id.strip()


def _replacement_http_error(exc: ValueError) -> None:
    msg = str(exc)
    code = 404 if "not found" in msg.lower() else 400
    raise HTTPException(status_code=code, detail=msg) from exc


def _fmt_srt_time(sec: float) -> str:
    sec = max(0.0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec - h * 3600 - m * 60
    whole = int(s)
    frac = s - whole
    ms = int(round(frac * 1000))
    if ms >= 1000:
        ms = 999
    return f"{h:02d}:{m:02d}:{whole:02d},{ms:03d}"


def _fmt_vtt_time(sec: float) -> str:
    sec = max(0.0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def _load_segments_for_export(episode_id: str):
    eid = _episode_id(episode_id)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    return episode_transcript_service.list_segments(eid)


@router.get("/{episode_id}/transcript", response_model=TranscriptOut)
def get_episode_transcript(episode_id: str):
    eid = _episode_id(episode_id)
    log.info("GET /episodes/%s/transcript", eid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        log.warning(
            "GET /episodes/%s/transcript -> 404 (no episode row; disk_loc=%s)",
            eid,
            store.locate_episode_upload_dir(eid),
        )
        raise HTTPException(status_code=404, detail="Episode not found")
    out = episode_transcript_service.get_transcript(eid)
    log.info(
        "GET /episodes/%s/transcript -> 200 segments=%s lang=%s",
        eid,
        len(out.segments),
        out.language,
    )
    return out


@router.get("/{episode_id}/transcript/export.txt", response_class=PlainTextResponse)
def export_episode_transcript_txt(episode_id: str):
    rows = _load_segments_for_export(episode_id)
    lines: list[str] = []
    for seg in rows:
        spk = (seg.speaker_label or "").strip() or "?"
        lines.append(f"[{seg.start_time:.2f}s] {spk}: {seg.text}")
    body = "\n".join(lines) if lines else ""
    return PlainTextResponse(body, media_type="text/plain; charset=utf-8")


@router.get("/{episode_id}/transcript/export.srt", response_class=PlainTextResponse)
def export_episode_transcript_srt(episode_id: str):
    rows = _load_segments_for_export(episode_id)
    blocks: list[str] = []
    for i, seg in enumerate(rows, start=1):
        spk = (seg.speaker_label or "").strip() or "?"
        line = f"{spk}: {seg.text}".strip()
        blocks.append(
            f"{i}\n{_fmt_srt_time(seg.start_time)} --> {_fmt_srt_time(seg.end_time)}\n{line}\n",
        )
    body = "\n".join(blocks)
    return PlainTextResponse(body, media_type="application/x-subrip; charset=utf-8")


@router.get("/{episode_id}/transcript/export.vtt", response_class=PlainTextResponse)
def export_episode_transcript_vtt(episode_id: str):
    rows = _load_segments_for_export(episode_id)
    lines_vtt = ["WEBVTT", ""]
    for seg in rows:
        spk = (seg.speaker_label or "").strip() or "?"
        line = f"{spk}: {seg.text}".strip()
        lines_vtt.append(
            f"{_fmt_vtt_time(seg.start_time)} --> {_fmt_vtt_time(seg.end_time)}\n{line}\n",
        )
    body = "\n".join(lines_vtt)
    return PlainTextResponse(body, media_type="text/vtt; charset=utf-8")


@router.delete("/{episode_id}", status_code=204)
def delete_episode(episode_id: str):
    eid = _episode_id(episode_id)
    log.info("DELETE /episodes/%s", eid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    ep = episode_service.get_episode(eid)
    project_id = ep.project_id if ep else None
    if not store.delete_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    if project_id:
        _cleanup_episode_files(project_id, eid)


@router.get("/{episode_id}/segments", response_model=list[TranscriptSegmentOut])
def list_episode_transcript_segments(episode_id: str):
    eid = _episode_id(episode_id)
    log.info("GET /episodes/%s/segments", eid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        log.warning(
            "GET /episodes/%s/segments -> 404 after ensure (disk_loc=%s transcript_cached=%s)",
            eid,
            store.locate_episode_upload_dir(eid),
            len(store.list_transcript_segments(eid)),
        )
        raise HTTPException(status_code=404, detail="Episode not found")
    rows = episode_transcript_service.list_segments(eid)
    log.info("GET /episodes/%s/segments -> 200 count=%s", eid, len(rows))
    return rows


@router.patch("/{episode_id}/segments/{segment_id}", response_model=TranscriptSegmentOut)
def patch_transcript_segment(episode_id: str, segment_id: str, body: PatchTranscriptSegmentBody):
    """Update transcript display text only (persists to DB and transcript.json; no audio generation)."""
    eid = _episode_id(episode_id)
    sid = segment_id.strip()
    log.info("PATCH /episodes/%s/segments/%s", eid, sid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    try:
        return episode_transcript_service.patch_segment_text(eid, sid, body.text)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.delete("/{episode_id}/segments/{segment_id}", status_code=204)
def delete_transcript_segment(episode_id: str, segment_id: str):
    """Soft-delete a transcript segment (hides from exports and UI)."""
    eid = _episode_id(episode_id)
    sid = segment_id.strip()
    log.info("DELETE /episodes/%s/segments/%s", eid, sid)
    ok = store.soft_delete_segment(eid, sid)
    if not ok:
        raise HTTPException(status_code=404, detail="Segment not found")


@router.get("/{episode_id}/segments/{segment_id}/audio")
def get_segment_source_audio(episode_id: str, segment_id: str):
    """Extract and serve a short WAV clip of the source audio for one transcript segment."""
    from storage_paths import STORAGE_ROOT
    eid = _episode_id(episode_id)
    sid = segment_id.strip()
    episode_service.ensure_uploaded_episode_in_memory(eid)
    ep = episode_service.get_episode(eid)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    segs = store.list_transcript_segments(eid, include_deleted=True)
    seg = next((s for s in segs if s.segment_id == sid), None)
    if not seg:
        raise HTTPException(status_code=404, detail="Segment not found")
    audio_rel = ep.extracted_audio_path
    if not audio_rel:
        raise HTTPException(
            status_code=404,
            detail="No extracted audio for this episode. Re-import the video if you expected source playback.",
        )
    audio_path = STORAGE_ROOT / audio_rel
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file missing")
    from services.ffmpeg_bin import get_ffmpeg_paths

    ffmpeg_exe, _ffprobe = get_ffmpeg_paths()
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        subprocess.run(
            [
                ffmpeg_exe,
                "-y",
                "-i", str(audio_path),
                "-ss", f"{seg.start_time:.3f}",
                "-to", f"{seg.end_time:.3f}",
                "-ac", "1", "-ar", "22050",
                tmp.name,
            ],
            capture_output=True, timeout=15, check=True,
        )
    except Exception as e:
        log.warning("segment audio extract failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not extract segment audio") from e
    def _cleanup() -> None:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    return FileResponse(
        tmp.name,
        media_type="audio/wav",
        filename=f"source_{sid}.wav",
        background=BackgroundTask(_cleanup),
    )


@router.get("/{episode_id}/speaker-groups", response_model=list[SpeakerGroupOut])
def list_speaker_groups(episode_id: str):
    eid = _episode_id(episode_id)
    log.info("GET /episodes/%s/speaker-groups", eid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    groups = store.list_speaker_groups(eid)
    out = [
        SpeakerGroupOut(
            speaker_label=g.speaker_label,
            display_name=g.display_name,
            segment_count=g.segment_count,
            total_speaking_duration=g.total_speaking_duration,
            sample_texts=g.sample_texts,
            is_narrator=g.is_narrator,
        )
        for g in groups
    ]
    log.info("GET /episodes/%s/speaker-groups -> 200 count=%s", eid, len(out))
    return out


@router.patch("/{episode_id}/speaker-groups/{speaker_label}", response_model=SpeakerGroupOut)
def rename_speaker_group(episode_id: str, speaker_label: str, body: SpeakerGroupRenameBody):
    eid = _episode_id(episode_id)
    log.info("PATCH /episodes/%s/speaker-groups/%s body=%s", eid, speaker_label, body.model_dump())
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    updated = store.rename_speaker_group(
        eid,
        speaker_label.strip(),
        display_name=body.display_name,
        is_narrator=body.is_narrator,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Speaker group '{speaker_label}' not found")
    return SpeakerGroupOut(
        speaker_label=updated.speaker_label,
        display_name=updated.display_name,
        segment_count=updated.segment_count,
        total_speaking_duration=updated.total_speaking_duration,
        sample_texts=updated.sample_texts,
        is_narrator=updated.is_narrator,
    )


@router.post("/{episode_id}/speaker-groups/merge", response_model=list[SpeakerGroupOut])
def merge_speaker_groups(episode_id: str, body: SpeakerGroupMergeBody):
    eid = _episode_id(episode_id)
    log.info(
        "POST /episodes/%s/speaker-groups/merge from=%s into=%s",
        eid,
        body.from_label,
        body.into_label,
    )
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    ok = store.merge_speaker_labels(
        eid,
        body.from_label.strip(),
        body.into_label.strip(),
    )
    if not ok:
        raise HTTPException(
            status_code=400,
            detail="Could not merge: labels missing or invalid",
        )
    groups = store.list_speaker_groups(eid)
    return [
        SpeakerGroupOut(
            speaker_label=g.speaker_label,
            display_name=g.display_name,
            segment_count=g.segment_count,
            total_speaking_duration=g.total_speaking_duration,
            sample_texts=g.sample_texts,
            is_narrator=g.is_narrator,
        )
        for g in groups
    ]


@router.post("/{episode_id}/speaker-groups/{speaker_label}/create-character", response_model=CharacterOut)
def create_character_from_group(episode_id: str, speaker_label: str, body: CreateCharacterFromGroupBody):
    eid = _episode_id(episode_id)
    log.info("POST /episodes/%s/speaker-groups/%s/create-character name=%s", eid, speaker_label, body.name)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    ep = episode_service.get_episode(eid)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    project_id = body.project_id or ep.project_id
    return character_service.create_character_from_group(
        episode_id=eid,
        speaker_label=speaker_label.strip(),
        name=body.name.strip(),
        project_id=project_id,
    )


@router.get("/{episode_id}/replacements", response_model=list[ReplacementOut])
def list_episode_replacements(episode_id: str):
    eid = _episode_id(episode_id)
    log.info("GET /episodes/%s/replacements", eid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    try:
        rows = replacement_service.list_replacements(eid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return rows


@router.post("/{episode_id}/segments/{segment_id}/replace", response_model=ReplacementOut)
def replace_segment(episode_id: str, segment_id: str, body: ReplaceSegmentBody):
    eid = _episode_id(episode_id)
    sid = segment_id.strip()
    log.info(
        "POST /episodes/%s/segments/%s/replace character_id=%s",
        eid,
        sid,
        body.character_id,
    )
    episode_service.ensure_uploaded_episode_in_memory(eid)
    try:
        return replacement_service.create_replacement(
            eid,
            sid,
            body.character_id.strip(),
            body.replacement_text,
            body.tone_style,
        )
    except ValueError as e:
        _replacement_http_error(e)


@router.patch("/{episode_id}/replacements/{replacement_id}", response_model=ReplacementOut)
def patch_episode_replacement(
    episode_id: str,
    replacement_id: str,
    body: PatchReplacementBody,
):
    eid = _episode_id(episode_id)
    rid = replacement_id.strip()
    log.info("PATCH /episodes/%s/replacements/%s", eid, rid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    try:
        return replacement_service.patch_replacement(eid, rid, body)
    except ValueError as e:
        _replacement_http_error(e)


@router.delete("/{episode_id}/replacements/{replacement_id}", status_code=204)
def delete_episode_replacement(episode_id: str, replacement_id: str):
    eid = _episode_id(episode_id)
    rid = replacement_id.strip()
    log.info("DELETE /episodes/%s/replacements/%s", eid, rid)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    try:
        replacement_service.delete_replacement(eid, rid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post(
    "/{episode_id}/segments/{segment_id}/generate-takes",
    response_model=list[ReplacementOut],
)
def generate_takes(episode_id: str, segment_id: str, body: GenerateTakesBody):
    """Generate N takes for a segment with a delivery preset."""
    eid = _episode_id(episode_id)
    sid = segment_id.strip()
    log.info(
        "POST /episodes/%s/segments/%s/generate-takes preset=%s count=%d",
        eid, sid, body.delivery_preset, body.take_count,
    )
    episode_service.ensure_uploaded_episode_in_memory(eid)
    try:
        from services.replacement_service import create_take
        results: list[ReplacementOut] = []
        for i in range(body.take_count):
            out = create_take(
                episode_id=eid,
                segment_id=sid,
                character_id=body.character_id,
                replacement_text=body.replacement_text,
                delivery_preset=body.delivery_preset,
                is_first=(i == 0),
            )
            results.append(out)
        return results
    except ValueError as e:
        _replacement_http_error(e)


@router.post("/{episode_id}/replacements/{replacement_id}/set-active", response_model=ReplacementOut)
def set_active_take(episode_id: str, replacement_id: str):
    """Set a take as the active one for its segment+character."""
    eid = _episode_id(episode_id)
    rid = replacement_id.strip()
    log.info("POST /episodes/%s/replacements/%s/set-active", eid, rid)
    rec = store.set_active_take(eid, rid)
    if not rec:
        raise HTTPException(status_code=404, detail="Replacement not found")
    from services.replacement_service import _to_out
    return _to_out(rec)


@router.post("/{episode_id}/export", response_model=JobOut)
def export_episode(episode_id: str, _body: EpisodeExportBody | None = None):
    eid = _episode_id(episode_id)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    return job_service.create_export_job(eid)
