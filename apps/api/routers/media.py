"""Media serving route.

When R2 is configured: resolves the appropriate bucket from the path prefix,
generates a presigned URL, and returns a 302 redirect.

When R2 is not configured (local dev): serves from STORAGE_ROOT via FileResponse.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from services.r2_storage import bucket_for_key, generate_presigned_url, r2_configured
from storage_paths import STORAGE_ROOT

router = APIRouter()


@router.get("/media/{path:path}")
async def serve_media(path: str):
    if r2_configured():
        url = generate_presigned_url(bucket_for_key(path), path, expires=3600)
        if url is None:
            raise HTTPException(status_code=404, detail="File not found")
        return RedirectResponse(url=url, status_code=302)

    local = STORAGE_ROOT / path
    if not local.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(local))
