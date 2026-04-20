from __future__ import annotations

from pydantic import BaseModel, Field


class VoiceClipOut(BaseModel):
    id: str
    character_id: str
    project_id: str
    voice_id: str
    voice_name: str
    text: str
    tone_style_hint: str
    audio_url: str
    title: str
    created_at: str


class VoiceClipPatch(BaseModel):
    title: str | None = Field(None, min_length=1)
