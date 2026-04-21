from __future__ import annotations

from pydantic import BaseModel, Field, field_serializer, field_validator


class ReplacementOut(BaseModel):
    replacement_id: str
    episode_id: str
    segment_id: str
    character_id: str
    character_name: str
    selected_voice_id: str
    selected_voice_name: str
    original_text: str
    replacement_text: str
    tone_style: str | None = None
    generated_audio_path: str
    audio_url: str
    provider_used: str
    fallback_used: bool
    created_at: str
    updated_at: str

    @field_validator("provider_used", mode="before")
    @classmethod
    def _sanitize_provider_used(cls, v: str | None) -> str:
        val = (str(v or "").strip().lower())
        if not val:
            return "fallback"
        if val in {"fallback", "local", "local_builtin", "stub"}:
            return "fallback"
        if val in {"ai"}:
            return "ai"
        return "primary"

    @field_serializer("provider_used")
    def _serialize_provider_used(self, v: str) -> str:
        val = (str(v or "").strip().lower())
        if not val:
            return "fallback"
        if val in {"fallback", "local", "local_builtin", "stub"}:
            return "fallback"
        if val in {"ai"}:
            return "ai"
        return "primary"


class ReplaceSegmentBody(BaseModel):
    character_id: str = Field(..., min_length=1)
    replacement_text: str = Field(..., min_length=1)
    tone_style: str | None = None


class PatchReplacementBody(BaseModel):
    replacement_text: str | None = None
    tone_style: str | None = None
    regenerate_audio: bool = False
