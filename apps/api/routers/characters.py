import logging

from fastapi import APIRouter, HTTPException

from schemas.character import (
    AssignVoiceBody,
    CharacterOut,
    GenerateBody,
    GeneratePreviewBody,
    PatchCharacterBody,
    PreviewOut,
    VoiceBody,
)
from schemas.job import JobOut
from services import character_service, job_service
from services.tts_service import generate_preview

router = APIRouter()
log = logging.getLogger("characpilot.characters")


@router.get("/{character_id}", response_model=CharacterOut)
def get_character(character_id: str):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    return c


@router.patch("/{character_id}", response_model=CharacterOut)
def patch_character(character_id: str, body: PatchCharacterBody):
    log.info("PATCH /characters/%s body=%s", character_id, body.model_dump(exclude_none=True))
    updates = body.model_dump(exclude_none=True)
    if not updates:
        c = character_service.get_character(character_id)
        if not c:
            raise HTTPException(status_code=404, detail="Character not found")
        return c
    updated = character_service.update_character(character_id, **updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


@router.post("/{character_id}/voice", response_model=CharacterOut)
def assign_voice(character_id: str, body: AssignVoiceBody):
    """Save a voice from the catalog (or custom ID) as the character's default voice."""
    log.info("POST /characters/%s/voice voice_id=%s", character_id, body.voice_id)
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    updated = character_service.update_character(
        character_id,
        default_voice_id=body.voice_id,
        voice_provider=body.provider or "catalog",
        voice_display_name=body.display_name or body.voice_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


@router.post("/{character_id}/generate", response_model=JobOut)
def queue_generate(character_id: str, _body: GenerateBody | None = None):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return job_service.create_generate_job(character_id)


@router.post("/{character_id}/generate-preview", response_model=PreviewOut)
def generate_preview_endpoint(character_id: str, body: GeneratePreviewBody):
    log.info("POST /characters/%s/generate-preview text=%s", character_id, body.text[:80])
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    try:
        result = generate_preview(
            character_id=character_id,
            text=body.text,
            voice_id=body.voice_id or c.default_voice_id,
            style=body.style,
        )
    except Exception as e:
        log.exception("generate-preview failed character_id=%s", character_id)
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e
    character_service.update_character(character_id, preview_audio_path=result["audio_url"])
    return PreviewOut(**result)
