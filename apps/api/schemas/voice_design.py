from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class VoicePreviewCandidateOut(BaseModel):
    generated_voice_id: str
    label: str
    preview_audio_url: str
    duration_secs: float | None = None


class DesignVoiceBody(BaseModel):
    voice_description: str = Field(..., min_length=1)
    preview_text: str = Field(..., min_length=1)
    model_id: str | None = Field(
        default=None,
        description="eleven_multilingual_ttv_v2 or eleven_ttv_v3",
    )


class DesignVoiceResponse(BaseModel):
    source: Literal["elevenlabs", "fallback"]
    message: str | None = None
    preview_text_used: str = ""
    candidates: list[VoicePreviewCandidateOut] = []
    normalized_retry_used: bool = False
    original_prompt: str | None = None
    rewritten_prompt: str | None = None
    safe_example_prompts: list[str] = []


class SaveCustomVoiceBody(BaseModel):
    character_id: str
    generated_voice_id: str
    voice_name: str = Field(..., min_length=1)
    voice_description: str = Field(..., min_length=1)
    source_type: Literal["designed", "remixed"] = "designed"
    parent_voice_id: str | None = None


class RemixVoiceBody(BaseModel):
    remix_prompt: str = Field(..., min_length=1)
    preview_text: str = Field(..., min_length=1)


class RemixVoiceResponse(BaseModel):
    source: Literal["elevenlabs", "fallback"]
    message: str | None = None
    preview_text_used: str = ""
    candidates: list[VoicePreviewCandidateOut] = []


class SaveCustomVoiceResult(BaseModel):
    character_id: str
    voice_id: str
    voice_name: str
    source_type: str
    provider: str = "elevenlabs"
