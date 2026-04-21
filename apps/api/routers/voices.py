"""Voice catalog — ElevenLabs when configured, else local fallback."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from schemas.voice_catalog import VoiceCatalogItem, VoiceCatalogResponse
from schemas.voice_design import (
    DesignVoiceBody,
    DesignVoiceResponse,
    RemixVoiceBody,
    RemixVoiceResponse,
    SaveCustomVoiceBody,
    SaveCustomVoiceResult,
)
from services import voice_design_service
from services.voice_catalog import get_voice_pool, paginate_voices, search_voices

router = APIRouter()
log = logging.getLogger("characpilot.voices")


def _to_items(raw: list[dict]) -> list[VoiceCatalogItem]:
    return [VoiceCatalogItem(**v) for v in raw]


def _safe_voice_error_message(msg: str) -> str:
    low = (msg or "").lower()
    if "character not found" in low:
        return "Character not found"
    if "parent_voice_id" in low:
        return "parent_voice_id is required when saving a remixed voice"
    return "Voice engine request could not be completed."


@router.post("/design", response_model=DesignVoiceResponse)
def post_voice_design(body: DesignVoiceBody):
    """Generate preview candidates from a text description (ElevenLabs Voice Design)."""
    return voice_design_service.design_voice(body)


@router.post("/design/save", response_model=SaveCustomVoiceResult)
def post_save_designed_voice(body: SaveCustomVoiceBody):
    """Create a permanent voice from a design preview and assign it to a character."""
    payload = body.model_copy(update={"source_type": "designed", "parent_voice_id": None})
    try:
        return voice_design_service.save_custom_voice(payload)
    except ValueError as e:
        log.warning("voice design/save failed: %s", e)
        raise HTTPException(status_code=400, detail=_safe_voice_error_message(str(e))) from e


@router.post("/remix/save", response_model=SaveCustomVoiceResult)
def post_save_remixed_voice(body: SaveCustomVoiceBody):
    """Create a voice from a remix preview and assign it to a character."""
    if not (body.parent_voice_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="parent_voice_id is required when saving a remixed voice",
        )
    payload = body.model_copy(update={"source_type": "remixed"})
    try:
        return voice_design_service.save_custom_voice(payload)
    except ValueError as e:
        log.warning("voice remix/save failed: %s", e)
        raise HTTPException(status_code=400, detail=_safe_voice_error_message(str(e))) from e


@router.post("/{voice_id}/remix", response_model=RemixVoiceResponse)
def post_voice_remix(voice_id: str, body: RemixVoiceBody):
    """Generate remix preview candidates for an existing ElevenLabs voice id."""
    return voice_design_service.remix_voice(voice_id, body)


@router.get("/catalog", response_model=VoiceCatalogResponse)
def get_voice_catalog(
    page: int = Query(1, ge=1, description="1-based page"),
    page_size: int = Query(50, ge=1, le=200, description="Items per page"),
):
    """List voices from ElevenLabs when `ELEVENLABS_API_KEY` is set; otherwise built-in catalog."""
    pool, source, msg = get_voice_pool()
    slice_rows, total = paginate_voices(pool, page, page_size)
    has_more = page * page_size < total
    return VoiceCatalogResponse(
        voices=_to_items(slice_rows),
        source=source,
        total=total,
        page=page,
        page_size=page_size,
        has_more=has_more,
        message=msg,
    )


@router.get("/catalog/search", response_model=VoiceCatalogResponse)
def search_voice_catalog(
    q: str = Query("", description="Filter by name, tags, description"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Search/filter the same voice pool as `/catalog` (name, tags, category, description)."""
    pool, source, msg = get_voice_pool()
    filtered = search_voices(pool, q)
    slice_rows, total = paginate_voices(filtered, page, page_size)
    has_more = page * page_size < total
    return VoiceCatalogResponse(
        voices=_to_items(slice_rows),
        source=source,
        total=total,
        page=page,
        page_size=page_size,
        has_more=has_more,
        message=msg,
    )
