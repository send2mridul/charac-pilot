import logging

from fastapi import APIRouter, HTTPException

from db.store import store
from schemas.episode import EpisodeExportBody
from schemas.job import JobOut
from schemas.transcript import TranscriptOut, TranscriptSegmentOut
from services import episode_service, episode_transcript_service, job_service

router = APIRouter()
log = logging.getLogger("characpilot.episodes")


def _episode_id(episode_id: str) -> str:
    return episode_id.strip()


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


@router.post("/{episode_id}/segments/{segment_id}/replace", response_model=JobOut)
def replace_segment(episode_id: str, segment_id: str):
    eid = _episode_id(episode_id)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    return job_service.create_replace_job(eid, segment_id.strip())


@router.post("/{episode_id}/export", response_model=JobOut)
def export_episode(episode_id: str, _body: EpisodeExportBody | None = None):
    eid = _episode_id(episode_id)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    return job_service.create_export_job(eid)
