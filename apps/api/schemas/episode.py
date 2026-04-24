from pydantic import BaseModel, Field


class EpisodeOut(BaseModel):
    id: str
    project_id: str
    title: str
    status: str
    segment_count: int
    updated_at: str
    source_video_path: str | None = None
    extracted_audio_path: str | None = None
    thumbnail_paths: list[str] = Field(default_factory=list)
    duration_sec: float | None = None
    transcript_language: str | None = None
    media_type: str = "video"


class EpisodeUploadBody(BaseModel):
    filename: str | None = None
    notes: str | None = None


class EpisodeCreateResult(BaseModel):
    job_id: str
    episode_id: str
    project_id: str
    message: str


class EpisodeExportBody(BaseModel):
    preset: str | None = "review_prores"
