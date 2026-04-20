from pydantic import BaseModel


class SpeakerGroupOut(BaseModel):
    speaker_label: str
    display_name: str
    segment_count: int
    total_speaking_duration: float
    sample_texts: list[str]
    is_narrator: bool = False


class SpeakerGroupRenameBody(BaseModel):
    display_name: str | None = None
    is_narrator: bool | None = None
