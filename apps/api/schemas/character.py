from pydantic import BaseModel


class CharacterOut(BaseModel):
    id: str
    project_id: str
    name: str
    role: str
    traits: list[str]
    wardrobe_notes: str
    continuity_rules: list[str]

    model_config = {"populate_by_name": True}


class VoiceBody(BaseModel):
    line: str | None = None
    preset: str | None = "pilot_a"


class GenerateBody(BaseModel):
    prompt: str | None = None
    count: int = 1
