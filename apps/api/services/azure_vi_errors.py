"""Safe, non-secret summaries for fallback_reason and operator logs."""

from __future__ import annotations

import re

import httpx
from azure.core.exceptions import ClientAuthenticationError

_REDACT = re.compile(r"(Bearer\s+\S+)|(accessToken[=:]\s*\S+)", re.I)


def sanitize_text(s: str, limit: int = 450) -> str:
    t = _REDACT.sub("[redacted]", s)
    t = " ".join(t.split())
    return t[:limit]


def brief_exception_for_fallback(exc: BaseException) -> str:
    """Short reason for job result / UI (no tokens or bearer strings)."""
    if isinstance(exc, ClientAuthenticationError):
        msg = getattr(exc, "message", None) or str(exc)
        return sanitize_text(f"DefaultAzureCredential: {msg}")
    if isinstance(exc, httpx.HTTPStatusError):
        detail = ""
        try:
            j = exc.response.json()
            err = j.get("error")
            if isinstance(err, dict):
                detail = str(err.get("message") or err.get("code") or "")
            elif isinstance(err, str):
                detail = err
            if not detail:
                detail = str(j.get("message") or "")
        except Exception:
            detail = (exc.response.text or "")[:200]
        op = "request"
        try:
            path = exc.request.url.path
            if "generateAccessToken" in path:
                op = "ARM_generateAccessToken"
            elif "/Videos" in path and exc.request.method == "POST":
                op = "VideoIndexer_upload"
            elif "/Index" in path:
                op = "VideoIndexer_index"
        except Exception:
            pass
        return sanitize_text(
            f"HTTP {exc.response.status_code} ({op}): "
            f"{detail or (exc.response.reason_phrase or '')}",
        )
    if isinstance(exc, httpx.RequestError):
        return sanitize_text(f"HTTP network error ({type(exc).__name__}): {exc}")
    return sanitize_text(f"{type(exc).__name__}: {exc}")
