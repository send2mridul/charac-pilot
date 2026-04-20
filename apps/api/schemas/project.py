from pydantic import BaseModel


class ProjectOut(BaseModel):
    id: str
    name: str
    status: str
    scene_count: int
    lead: str
    updated_at: str


class ProjectCreate(BaseModel):
    name: str
    lead: str = "You"
