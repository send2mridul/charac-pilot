from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class VoiceCatalogItem(BaseModel):
    voice_id: str
    display_name: str
    description: str = ""
    category: str | None = None
    tags: list[str] = Field(default_factory=list)
    suggested_use: str = ""


class VoiceCatalogResponse(BaseModel):
    voices: list[VoiceCatalogItem]
    source: Literal["primary", "local_fallback"]
    total: int
    page: int = 1
    page_size: int = 50
    has_more: bool = False
    message: str | None = None
