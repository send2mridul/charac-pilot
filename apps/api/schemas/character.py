from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


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
