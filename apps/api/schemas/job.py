from typing import Any

from pydantic import BaseModel, computed_field


class JobOut(BaseModel):
    id: str
    type: str
    status: str
    progress: float
    message: str
    result: dict[str, Any] | None = None
    created_at: str
    updated_at: str

    @computed_field  # type: ignore[prop-decorator]
    @property
    def terminal(self) -> bool:
        """True when `status` is done, failed, or cancelled — safe to stop polling."""
        s = (self.status or "").strip().lower()
        return s in ("done", "failed", "cancelled")
