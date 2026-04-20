from pydantic import BaseModel


class TranscriptSegmentOut(BaseModel):
    segment_id: str
    episode_id: str
    start_time: float
    end_time: float
    text: str
    speaker_label: str | None = None


class TranscriptOut(BaseModel):
    episode_id: str
    language: str | None = None
    segments: list[TranscriptSegmentOut]
