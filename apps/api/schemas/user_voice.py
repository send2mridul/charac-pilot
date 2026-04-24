from __future__ import annotations

from pydantic import BaseModel


class UserVoiceOut(BaseModel):
    id: str
    name: str
    elevenlabs_voice_id: str | None = None
    source_type: str
    rights_type: str
    preview_url: str | None = None
    created_at: str
