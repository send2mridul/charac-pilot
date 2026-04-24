"""Local filesystem paths for uploads and database."""

from __future__ import annotations

import os
from pathlib import Path

_custom = os.environ.get("CASTWEAVE_STORAGE_PATH", "").strip()
STORAGE_ROOT = Path(_custom) if _custom else Path(__file__).resolve().parent / "storage"
UPLOADS_ROOT = STORAGE_ROOT / "uploads"
DATABASE_PATH = STORAGE_ROOT / "characpilot.db"


def ensure_storage_dirs() -> None:
    UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "replacements").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "voice_design").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "avatars").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "clips").mkdir(parents=True, exist_ok=True)


def to_rel_storage_path(absolute: Path) -> str:
    abs_norm = absolute.resolve()
    try:
        return abs_norm.relative_to(STORAGE_ROOT.resolve()).as_posix()
    except ValueError:
        return abs_norm.as_posix()
