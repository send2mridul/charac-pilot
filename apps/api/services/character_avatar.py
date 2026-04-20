"""Persist character avatar uploads (shared by /characters/... and /projects/.../characters/... routes)."""

from pathlib import Path

from fastapi import HTTPException, UploadFile

from services import character_service
from storage_paths import STORAGE_ROOT, ensure_storage_dirs, to_rel_storage_path

_AVATAR_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


async def save_character_avatar_file(character_id: str, file: UploadFile):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in _AVATAR_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail="Use a common image format (JPEG, PNG, WebP, or GIF).",
        )
    ensure_storage_dirs()
    dest_dir = STORAGE_ROOT / "avatars" / character_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"avatar{suffix}"
    try:
        with dest.open("wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                buffer.write(chunk)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not save image: {e}") from e
    rel = to_rel_storage_path(dest)
    updated = character_service.update_character(character_id, thumbnail_paths=[rel])
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated
