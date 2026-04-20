from __future__ import annotations

from db.store import STUB_POLL_ADVANCE_TYPES, JobRecord, store
from schemas.job import JobOut


def get_job(job_id: str) -> JobOut | None:
    job = store.peek_job(job_id)
    if not job:
        return None
    if job.type in STUB_POLL_ADVANCE_TYPES:
        refreshed = store.touch_job_progress(job_id)
        if not refreshed:
            return None
        return _to_out(refreshed)
    return _to_out(job)


def create_episode_media_job(
    project_id: str,
    episode_id: str,
    filename: str,
) -> JobOut:
    job = store.create_job(
        "episode_media",
        f"Queued processing for {filename}",
        result={"episode_id": episode_id, "project_id": project_id},
        episode_id=episode_id,
    )
    return _to_out(job)


def create_voice_job(character_id: str) -> JobOut:
    job = store.create_job(
        "voice_preview",
        f"Voice preview queued for character {character_id}",
    )
    return _to_out(job)


def create_generate_job(character_id: str) -> JobOut:
    job = store.create_job(
        "character_generate",
        f"Generation queued for character {character_id}",
    )
    return _to_out(job)


def create_replace_job(episode_id: str, segment_id: str) -> JobOut:
    job = store.create_job(
        "segment_replace",
        f"Replace segment {segment_id} in episode {episode_id}",
    )
    return _to_out(job)


def create_export_job(episode_id: str) -> JobOut:
    job = store.create_job(
        "episode_export",
        f"Export queued for episode {episode_id}",
    )
    return _to_out(job)


def _to_out(j: JobRecord) -> JobOut:
    return JobOut(
        id=j.id,
        type=j.type,
        status=j.status,
        progress=j.progress,
        message=j.message,
        result=j.result,
        created_at=j.created_at,
        updated_at=j.updated_at,
    )
