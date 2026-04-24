"""Media serving route.

When R2 is configured: resolves the appropriate bucket from the path prefix,
generates a presigned URL, and returns a 302 redirect.

When R2 is not configured (local dev): serves from STORAGE_ROOT via FileResponse.

All media requests require a valid JWT **and** ownership verification:
the authenticated user must own the resource that the media belongs to.
"""

from __future__ import annotations

import hashlib
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from auth import check_ownership, require_user_id
from db.store import store
from services.r2_storage import bucket_for_key, generate_presigned_url, r2_configured
from storage_paths import STORAGE_ROOT

router = APIRouter()
log = logging.getLogger("characpilot.media")


def _user_hash(user_id: str) -> str:
    """Deterministic short hash of user identity for voice_design path verification."""
    return hashlib.sha256(user_id.encode()).hexdigest()[:16]


def _resolve_owner(prefix: str, resource_id: str) -> str | None:
    """Look up the owning user_id for a resource identified by path prefix + ID."""
    if prefix == "uploads":
        return store.project_owner_id(resource_id)
    if prefix in ("replacements", "speaker_samples"):
        return store.episode_owner_id(resource_id)
    if prefix == "user_voice_samples":
        return store.user_voice_owner_id(resource_id)
    if prefix in ("avatars", "clips", "previews"):
        return store.character_owner_id(resource_id)
    return None


def _verify_media_ownership(path: str, user_id: str) -> None:
    """Enforce that the authenticated user owns the resource behind this media path.

    Raises 404 on any mismatch or unrecognised prefix (deny by default).
    """
    parts = path.replace("\\", "/").split("/")
    if len(parts) < 2:
        raise HTTPException(status_code=404, detail="File not found")

    prefix = parts[0]

    if prefix == "voice_design":
        if parts[1] != _user_hash(user_id):
            raise HTTPException(status_code=404, detail="File not found")
        return

    owner = _resolve_owner(prefix, parts[1])
    check_ownership(owner, user_id)


@router.get("/media/{path:path}")
async def serve_media(path: str, user_id: str = Depends(require_user_id)):
    _verify_media_ownership(path, user_id)

    if r2_configured():
        url = generate_presigned_url(bucket_for_key(path), path, expires=3600)
        if url is None:
            raise HTTPException(status_code=404, detail="File not found")
        return RedirectResponse(url=url, status_code=302)

    local = STORAGE_ROOT / path
    if not local.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(local))
