from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_serializer, field_validator

# Scene prompt for draft line generation (MVP cap; keep in sync with web).
PROMPT_MAX_CHARS = 600


class CharacterOut(BaseModel):
    id: str
    project_id: str
    name: str
    role: str
    traits: list[str]
    wardrobe_notes: str
    continuity_rules: list[str]
    thumbnail_paths: list[str] = []
    source_speaker_labels: list[str] = []
    source_episode_id: str | None = None
    segment_count: int = 0
    total_speaking_duration: float = 0.0
    sample_texts: list[str] = []
    is_narrator: bool = False
    default_voice_id: str | None = None
    voice_provider: str | None = None
    voice_display_name: str | None = None
    voice_style_presets: dict[str, Any] | None = None
    preview_audio_path: str | None = None
    voice_source_type: str | None = None
    voice_parent_id: str | None = None
    voice_description_meta: str | None = None

    model_config = {"populate_by_name": True}

    @field_validator("voice_provider", mode="before")
    @classmethod
    def _sanitize_voice_provider(cls, v: str | None):
        if v is None:
            return None
        val = str(v).strip().lower()
        if not val:
            return None
        if val in {"local_builtin", "local", "fallback"}:
            return "fallback"
        return "primary"

    @field_serializer("voice_provider")
    def _serialize_voice_provider(self, v: str | None):
        if v is None:
            return None
        val = str(v).strip().lower()
        if not val:
            return None
        if val in {"local_builtin", "local", "fallback"}:
            return "fallback"
        return "primary"


class CreateCharacterFromGroupBody(BaseModel):
    name: str
    project_id: str | None = None


class CreateManualCharacterBody(BaseModel):
    name: str = Field(..., min_length=1)
    role: str = ""
    wardrobe_notes: str = ""


class PatchCharacterBody(BaseModel):
    name: str | None = None
    role: str | None = None
    default_voice_id: str | None = None
    voice_provider: str | None = None
    voice_display_name: str | None = None
    voice_style_presets: dict[str, Any] | None = None
    voice_source_type: str | None = None
    voice_parent_id: str | None = None
    voice_description_meta: str | None = None
    is_narrator: bool | None = None
    traits: list[str] | None = None
    wardrobe_notes: str | None = None
    continuity_rules: list[str] | None = None
    thumbnail_paths: list[str] | None = None


class GeneratePreviewBody(BaseModel):
    text: str
    voice_id: str | None = None
    style: str | None = None
    save_clip: bool = True
    clip_title: str | None = None


class GenerateClipsBody(BaseModel):
    mode: str = Field(default="multi_line")
    lines: list[str] = []
    prompt: str | None = Field(default=None, max_length=PROMPT_MAX_CHARS)
    count: int = 3
    style: str | None = None
    clip_label_prefix: str | None = None
    voice_id: str | None = None


class GenerateLinesBody(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=PROMPT_MAX_CHARS)
    count: int = Field(default=4, ge=1, le=12)
    style: str | None = None


class PreviewOut(BaseModel):
    preview_id: str
    character_id: str
    audio_url: str
    duration_ms: int
    text: str
    provider: str
    clip_id: str | None = None


class AssignVoiceBody(BaseModel):
    voice_id: str
    provider: str | None = None
    display_name: str | None = None
    voice_source_type: str | None = "catalog"


class VoiceBody(BaseModel):
    line: str | None = None
    preset: str | None = "pilot_a"


class GenerateBody(BaseModel):
    prompt: str | None = None
    count: int = 1


class BatchGeneratedClipOut(BaseModel):
    clip_id: str
    title: str
    text: str
    audio_url: str
    tone_style_hint: str
    created_at: str


class GenerateClipsOut(BaseModel):
    character_id: str
    mode: str
    provider: str
    generated_count: int
    clips: list[BatchGeneratedClipOut]


class GenerateLinesOut(BaseModel):
    character_id: str
    prompt: str
    generated_count: int
    lines: list[str]


class DraftLineOut(BaseModel):
    order: int
    text: str
    tone_style: str = ""


class GenerateDraftLinesOut(BaseModel):
    character_id: str
    prompt: str
    generated_count: int
    lines: list[DraftLineOut]
    provider_used: str = "fallback"
    fallback_used: bool = False


class ClipLineIn(BaseModel):
    text: str
    tone_style: str | None = None


class GenerateClipsFromLinesBody(BaseModel):
    lines: list[ClipLineIn] = []
    style: str | None = None
    clip_label_prefix: str | None = None
    voice_id: str | None = None
