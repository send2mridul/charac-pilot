import logging

from fastapi import APIRouter, HTTPException

from db.store import store
from schemas.character import CharacterOut, CreateCharacterFromGroupBody
from schemas.episode import EpisodeExportBody
from schemas.job import JobOut
from schemas.replacement import PatchReplacementBody, ReplaceSegmentBody, ReplacementOut
from schemas.speaker_group import SpeakerGroupMergeBody, SpeakerGroupOut, SpeakerGroupRenameBody
from schemas.transcript import TranscriptOut, TranscriptSegmentOut
from services import character_service, episode_service, episode_transcript_service, job_service
from services import replacement_service

router = APIRouter()
log = logging.getLogger("characpilot.episodes")


def _episode_id(episode_id: str) -> str:
    return episode_id.strip()


def _replacement_http_error(exc: ValueError) -> None:
    msg = str(exc)
    code = 404 if "not found" in msg.lower() else 400
    raise HTTPException(status_code=code, detail=msg) from exc


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


@router.post("/{episode_id}/export", response_model=JobOut)
def export_episode(episode_id: str, _body: EpisodeExportBody | None = None):
    eid = _episode_id(episode_id)
    episode_service.ensure_uploaded_episode_in_memory(eid)
    if not episode_service.get_episode(eid):
        raise HTTPException(status_code=404, detail="Episode not found")
    return job_service.create_export_job(eid)
