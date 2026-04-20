"""Voice catalog — ElevenLabs when configured, else local fallback."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from schemas.voice_catalog import VoiceCatalogItem, VoiceCatalogResponse
from services.voice_catalog import get_voice_pool, paginate_voices, search_voices

router = APIRouter()
log = logging.getLogger("characpilot.voices")


def _to_items(raw: list[dict]) -> list[VoiceCatalogItem]:
    return [VoiceCatalogItem(**v) for v in raw]


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
