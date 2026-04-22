from __future__ import annotations

from db.store import EpisodeRecord, store
from schemas.episode import EpisodeOut


def list_episodes(project_id: str) -> list[EpisodeOut]:
    return [_to_out(e) for e in store.list_episodes(project_id)]


def get_episode(episode_id: str) -> EpisodeOut | None:
    e = store.get_episode(episode_id)
    return _to_out(e) if e else None


def create_upload_episode(project_id: str, title: str) -> EpisodeOut:
    rec = store.create_episode(project_id, title, status="processing")
    return _to_out(rec)


def ensure_uploaded_episode_in_memory(episode_id: str) -> None:
    """Re-register episode + transcript after API restart if upload files still exist."""
    store.ensure_episode_from_upload_dir(episode_id)


def _to_out(e: EpisodeRecord) -> EpisodeOut:
    return EpisodeOut(
        id=e.id,
        project_id=e.project_id,
        title=e.title,
        status=e.status,
        segment_count=e.segment_count,
        updated_at=e.updated_at,
        source_video_path=e.source_video_rel,
        extracted_audio_path=e.extracted_audio_rel,
        thumbnail_paths=list(e.thumbnail_rels),
        duration_sec=e.duration_sec,
    )
