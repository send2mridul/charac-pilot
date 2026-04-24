"""Typed metadata records shared by the persistence layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ProjectRecord:
    id: str
    name: str
    status: str
    scene_count: int
    lead: str
    updated_at: str
    description: str = ""
    user_id: str | None = None


@dataclass
class EpisodeRecord:
    id: str
    project_id: str
    title: str
    status: str
    segment_count: int
    updated_at: str
    source_video_rel: str | None = None
    extracted_audio_rel: str | None = None
    thumbnail_rels: list[str] = field(default_factory=list)
    duration_sec: float | None = None
    transcript_language: str | None = None
    media_type: str = "video"


@dataclass
class TranscriptSegmentRecord:
    segment_id: str
    episode_id: str
    start_time: float
    end_time: float
    text: str
    speaker_label: str | None
    """Source-script transcript (e.g. Devanagari Hindi) when display is romanized."""
    text_original: str | None = None
    """Optional English gloss; not used as default UI transcript."""
    text_translation_en: str | None = None
    """Soft-delete flag: 1 = hidden from UI/exports/batch, 0 = active."""
    deleted: int = 0


@dataclass
class SpeakerGroupRecord:
    speaker_label: str
    episode_id: str
    display_name: str
    segment_count: int
    total_speaking_duration: float
    sample_texts: list[str]
    is_narrator: bool = False


@dataclass
class ReplacementRecord:
    replacement_id: str
    episode_id: str
    segment_id: str
    character_id: str
    character_name: str
    selected_voice_id: str
    selected_voice_name: str
    original_text: str
    replacement_text: str
    tone_style: str | None
    generated_audio_path: str
    provider_used: str
    fallback_used: bool
    created_at: str
    updated_at: str
    take_number: int = 1
    is_active_take: int = 1
    delivery_preset: str = "neutral"


@dataclass
class UserVoiceRecord:
    id: str
    name: str
    elevenlabs_voice_id: str | None
    source_type: str
    sample_audio_path: str | None
    rights_type: str
    rights_note: str = ""
    preview_audio_path: str | None = None
    created_at: str = field(default_factory=_now_iso)
    user_id: str | None = None


@dataclass
class CharacterRecord:
    id: str
    project_id: str
    name: str
    role: str
    traits: list[str]
    wardrobe_notes: str
    continuity_rules: list[str]
    source_speaker_labels: list[str] = field(default_factory=list)
    source_episode_id: str | None = None
    segment_count: int = 0
    total_speaking_duration: float = 0.0
    sample_texts: list[str] = field(default_factory=list)
    thumbnail_paths: list[str] = field(default_factory=list)
    is_narrator: bool = False
    default_voice_id: str | None = None
    voice_provider: str | None = None
    voice_display_name: str | None = None
    voice_style_presets: dict[str, Any] | None = None
    preview_audio_path: str | None = None
    voice_source_type: str | None = None
    voice_parent_id: str | None = None
    voice_description_meta: str | None = None
    source_matched_voice_enabled: bool = False
    source_matched_rights_confirmed: bool = False
    source_matched_rights_type: str | None = None
    source_matched_proof_note: str | None = None
    source_matched_voice_id: str | None = None


@dataclass
class VoiceClipRecord:
    id: str
    character_id: str
    project_id: str
    voice_id: str
    voice_name: str
    text: str
    tone_style_hint: str
    audio_path: str
    title: str
    created_at: str


@dataclass
class JobRecord:
    id: str
    type: str
    status: str
    progress: float
    message: str
    poll_count: int = 0
    result: dict[str, Any] | None = None
    episode_id: str | None = None
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)


# Jobs that advance queued → running → done when GET /jobs/{id} is polled (stub workers).
STUB_POLL_ADVANCE_TYPES = frozenset(
    {"voice_preview", "character_generate", "segment_replace", "episode_export"},
)
