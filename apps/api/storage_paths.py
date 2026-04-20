"""Local filesystem paths for uploads (dev only)."""

from __future__ import annotations

from pathlib import Path

# apps/api/storage
STORAGE_ROOT = Path(__file__).resolve().parent / "storage"
UPLOADS_ROOT = STORAGE_ROOT / "uploads"


def ensure_storage_dirs() -> None:
    UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)


def to_rel_storage_path(absolute: Path) -> str:
    abs_norm = absolute.resolve()
    try:
        return abs_norm.relative_to(STORAGE_ROOT.resolve()).as_posix()
    except ValueError:
        return abs_norm.as_posix()
