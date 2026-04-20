from pydantic import BaseModel


class EpisodeOut(BaseModel):
    id: str
    project_id: str
    title: str
    status: str
    segment_count: int
    updated_at: str


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
