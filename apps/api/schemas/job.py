from typing import Any

from pydantic import BaseModel


class JobOut(BaseModel):
    id: str
    type: str
    status: str
    progress: float
    message: str
    result: dict[str, Any] | None = None
    created_at: str
    updated_at: str
