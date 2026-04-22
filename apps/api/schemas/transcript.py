from pydantic import BaseModel, Field


class PatchTranscriptSegmentBody(BaseModel):
    """Update stored display text only (no TTS). Clears text_original so Hindi TTS follows edited line."""

    text: str = Field(..., min_length=1)


class TranscriptSegmentOut(BaseModel):
    segment_id: str
    episode_id: str
    start_time: float
    end_time: float
    text: str
    speaker_label: str | None = None
    """Source script (e.g. Devanagari) when `text` is romanized for display."""
    text_original: str | None = None
    text_translation_en: str | None = None


class TranscriptOut(BaseModel):
    episode_id: str
    """BCP-47 style short code (e.g. en, hi). Same as spoken content language."""
    language: str | None = None
    segments: list[TranscriptSegmentOut]
