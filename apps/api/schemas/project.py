from pydantic import BaseModel, Field


class ProjectOut(BaseModel):
    id: str
    name: str
    status: str
    scene_count: int
    lead: str
    updated_at: str
    description: str = ""


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1)
    lead: str = "You"
    description: str = ""


class ProjectPatch(BaseModel):
    name: str | None = Field(None, min_length=1)
    lead: str | None = None
    description: str | None = None
