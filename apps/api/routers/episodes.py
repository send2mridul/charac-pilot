import logging

from fastapi import APIRouter, HTTPException

from db.store import store
from schemas.character import CharacterOut, CreateCharacterFromGroupBody
from schemas.episode import EpisodeExportBody
from schemas.job import JobOut
from schemas.speaker_group import SpeakerGroupOut, SpeakerGroupRenameBody
from schemas.transcript import TranscriptOut, TranscriptSegmentOut
from services import character_service, episode_service, episode_transcript_service, job_service

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
