"""Backend authentication via cryptographically signed JWT tokens.

The frontend authenticates via NextAuth (Google OAuth) and then calls
GET /api/auth/api-token, which issues a short-lived HS256 JWT signed
with API_AUTH_SECRET (separate from AUTH_SECRET used by NextAuth).
The Python backend verifies the signature and
derives user identity from the verified payload -- never from a
plain spoofable header.

Token can be passed as:
  - Authorization: Bearer <token>   (for fetch/XHR requests)
  - ?token=<token>                  (for <img>/<audio> elements)
"""

from __future__ import annotations

import logging
import os

from fastapi import Header, HTTPException, Query

log = logging.getLogger("characpilot.auth")


def _get_api_secret() -> str:
    secret = os.environ.get("API_AUTH_SECRET", "")
    if not secret:
        log.warning("API_AUTH_SECRET is not set; JWT verification will fail")
    return secret


def _extract_bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def _verify_jwt(raw_token: str) -> str:
    """Verify HS256 JWT and return the subject (user email). Raises HTTPException."""
    try:
        import jwt as pyjwt
    except ImportError:
        raise HTTPException(status_code=500, detail="JWT library not available")

    secret = _get_api_secret()
    if not secret:
        raise HTTPException(status_code=500, detail="Auth not configured on server")

    try:
        payload = pyjwt.decode(raw_token, secret, algorithms=["HS256"])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = (payload.get("sub") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Token missing subject")

    return email


def get_current_user_id(
    authorization: str | None = Header(None),
    token: str | None = Query(None, alias="token"),
) -> str | None:
    """Optional auth -- returns verified user email or None."""
    raw = _extract_bearer(authorization) or token
    if not raw:
        return None
    try:
        return _verify_jwt(raw)
    except HTTPException:
        return None


def require_user_id(
    authorization: str | None = Header(None),
    token: str | None = Query(None, alias="token"),
) -> str:
    """Required auth -- returns verified user email or raises 401."""
    raw = _extract_bearer(authorization) or token
    if not raw:
        raise HTTPException(status_code=401, detail="Authentication required")
    return _verify_jwt(raw)


def check_ownership(owner_id: str | None, user_id: str) -> None:
    """Raise 404 if owner_id doesn't match user_id (or resource doesn't exist).

    Returns 404 (not 403) to avoid revealing resource existence to unauthorized users.
    """
    if owner_id is None or owner_id != user_id:
        raise HTTPException(status_code=404, detail="Resource not found")
