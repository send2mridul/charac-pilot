"""ARM + Video Indexer access tokens; in-memory cache only.

Local dev: AzureCliCredential ONLY (az login) — no IMDS, no DefaultAzure chain.
Production (managed identity allowed): DefaultAzureCredential.

IMPORTANT: Never hold _token_lock while calling credential.get_token, httpx, or logging
that might contend with other request threads (avoids obscure deadlocks).
"""

from __future__ import annotations

import base64
import json
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Any

import httpx
from azure.core.credentials import TokenCredential
from azure.core.exceptions import ClientAuthenticationError
from azure.identity import AzureCliCredential, DefaultAzureCredential

from services import azure_vi_config as cfg
from services.azure_vi_diag import azure_vi_line
from services.azure_vi_errors import brief_exception_for_fallback

logger = logging.getLogger(__name__)

# Bump when changing auth/diagnostics so running processes are obvious in logs.
TOKEN_MODULE_DIAG_VERSION = "v2"

_ARM_SCOPE = "https://management.azure.com/.default"

_token_lock = threading.RLock()
_cached_arm_token: tuple[str, float] | None = None
_cached_vi_token: tuple[str, float] | None = None

_arm_credential_singleton: TokenCredential | None = None
_arm_credential_lock = threading.Lock()


def _diag_print(msg: str) -> None:
    """Stdout only — never use logging (avoids lock inversion with _token_lock)."""
    print(
        f"[characpilot] Azure VI TOKEN MODULE VERSION: {TOKEN_MODULE_DIAG_VERSION} | {msg}",
        flush=True,
        file=sys.stdout,
    )


def _create_arm_credential() -> TokenCredential:
    if cfg.azure_allow_managed_identity():
        azure_vi_line(
            "credential: production — DefaultAzureCredential (Managed Identity enabled)",
        )
        logger.info(
            "Azure VI: DefaultAzureCredential with Managed Identity "
            "(AZURE_USE_MANAGED_IDENTITY=1 or Azure host env)",
        )
        return DefaultAzureCredential(exclude_interactive_browser_credential=True)

    azure_vi_line(
        "credential: local/dev — AzureCliCredential ONLY "
        "(run `az login`; no Managed Identity / IMDS / DefaultAzure chain)",
    )
    logger.info(
        "Azure VI: AzureCliCredential only for ARM scope (local development)",
    )
    return AzureCliCredential()


def _get_arm_credential() -> TokenCredential:
    global _arm_credential_singleton
    if _arm_credential_singleton is not None:
        return _arm_credential_singleton
    _diag_print("_get_arm_credential: before _arm_credential_lock acquire")
    with _arm_credential_lock:
        _diag_print("_get_arm_credential: after _arm_credential_lock acquired")
        if _arm_credential_singleton is None:
            _diag_print("_get_arm_credential: constructing credential (first use)")
            _arm_credential_singleton = _create_arm_credential()
            _diag_print("_get_arm_credential: credential construction finished")
        return _arm_credential_singleton


def _jwt_expiry_epoch(token: str) -> float | None:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        pad = "=" * (-len(parts[1]) % 4)
        payload = json.loads(
            base64.urlsafe_b64decode(parts[1] + pad).decode("utf-8"),
        )
        exp = payload.get("exp")
        if isinstance(exp, (int, float)):
            return float(exp)
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
        return None
    return None


def _token_valid_until(token: str, fallback_ttl_sec: float) -> float:
    exp = _jwt_expiry_epoch(token)
    now = time.time()
    if exp is not None:
        return max(now, exp - 120)
    return now + fallback_ttl_sec


def get_arm_access_token() -> str:
    """Token for management.azure.com (generateAccessToken)."""
    global _cached_arm_token
    _diag_print("get_arm_access_token: entered")
    now = time.time()

    _diag_print("get_arm_access_token: before _token_lock acquire (read ARM cache)")
    with _token_lock:
        _diag_print("get_arm_access_token: after _token_lock acquired (read ARM cache)")
        if _cached_arm_token and _cached_arm_token[1] > now + 30:
            _diag_print("get_arm_access_token: ARM cache HIT — return")
            return _cached_arm_token[0]
    _diag_print("get_arm_access_token: lock released (ARM cache miss — will call get_token)")

    cred = _get_arm_credential()
    timeout_sec = cfg.arm_get_token_timeout_sec()
    azure_vi_line(
        "ARM token: before credential.get_token (scope=management.azure.com, timeout=%.0fs)",
        timeout_sec,
    )
    logger.info(
        "Azure VI: before get_token(scope=management.azure.com); timeout_sec=%.0f",
        timeout_sec,
    )

    def _get_token_call():
        return cred.get_token(_ARM_SCOPE)

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(_get_token_call)
            try:
                token = fut.result(timeout=timeout_sec)
            except FuturesTimeout as e:
                azure_vi_line(
                    "ARM token: TIMEOUT after credential.get_token (%.0fs) — "
                    "check `az login`, Azure CLI, or managed identity / network",
                    timeout_sec,
                )
                raise TimeoutError(
                    f"ARM credential.get_token timed out after {timeout_sec:.0f}s",
                ) from e
    except ClientAuthenticationError as e:
        azure_vi_line(
            "ARM token: FAILED after credential.get_token — %s",
            brief_exception_for_fallback(e),
        )
        logger.error(
            "Azure VI: credential.get_token failed — %s",
            brief_exception_for_fallback(e),
        )
        raise
    except Exception as e:
        azure_vi_line(
            "ARM token: FAILED unexpected after credential.get_token — %s",
            brief_exception_for_fallback(e),
        )
        logger.error(
            "Azure VI: unexpected credential error — %s",
            brief_exception_for_fallback(e),
        )
        raise

    azure_vi_line("ARM token: after credential.get_token OK")
    ttl = _token_valid_until(token.token, 25 * 60)

    _diag_print("get_arm_access_token: before _token_lock acquire (write ARM cache)")
    with _token_lock:
        _diag_print("get_arm_access_token: after _token_lock acquired (write ARM cache)")
        if _cached_arm_token and _cached_arm_token[1] > time.time() + 30:
            _diag_print("get_arm_access_token: peer refreshed ARM cache — return cached")
            return _cached_arm_token[0]
        _cached_arm_token = (token.token, ttl)
    _diag_print("get_arm_access_token: lock released (ARM cache stored)")

    azure_vi_line(
        "ARM token: OK (cached ~%ds)",
        int(ttl - now),
    )
    logger.info(
        "Azure VI: ARM access token cached (~%ss TTL)",
        int(ttl - now),
    )
    return token.token


def _generate_video_indexer_access_token(arm_token: str) -> str:
    sub = cfg.subscription_id()
    rg = cfg.resource_group()
    name = cfg.account_name()
    ver = cfg.arm_api_version()
    url = (
        f"https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}"
        f"/providers/Microsoft.VideoIndexer/accounts/{name}/generateAccessToken"
        f"?api-version={ver}"
    )
    body: dict[str, Any] = {
        "permissionType": "Contributor",
        "scope": "Account",
    }
    headers = {
        "Authorization": f"Bearer {arm_token}",
        "Content-Type": "application/json",
    }
    http_timeout = cfg.arm_generate_token_http_timeout_sec()
    azure_vi_line(
        "VI JWT: before ARM generateAccessToken HTTP POST (api-version=%s account=%s timeout=%.0fs)",
        ver,
        name,
        http_timeout,
    )
    logger.info(
        "Azure VI: before ARM generateAccessToken POST (api-version=%s, account=%s)",
        ver,
        name,
    )
    timeout = httpx.Timeout(http_timeout, connect=min(30.0, http_timeout))

    def _do_posts() -> httpx.Response:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, headers=headers, json=body)
            if r.status_code == 400:
                azure_vi_line(
                    "VI JWT: ARM generateAccessToken first POST returned 400; "
                    "retry with properties wrapper",
                )
                alt = {"properties": body}
                r = client.post(url, headers=headers, json=alt)
            return r

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(_do_posts)
            try:
                r = fut.result(timeout=http_timeout + 5.0)
            except FuturesTimeout as e:
                azure_vi_line(
                    "VI JWT: TIMEOUT waiting for ARM generateAccessToken HTTP (%.0fs)",
                    http_timeout,
                )
                raise TimeoutError(
                    f"ARM generateAccessToken HTTP timed out after {http_timeout:.0f}s",
                ) from e
    except httpx.TimeoutException as e:
        azure_vi_line(
            "VI JWT: ARM generateAccessToken HTTP client timeout — %s",
            brief_exception_for_fallback(e),
        )
        raise TimeoutError(
            f"ARM generateAccessToken HTTP timeout: {brief_exception_for_fallback(e)}",
        ) from e

    azure_vi_line(
        "VI JWT: after ARM generateAccessToken HTTP response status=%s body_bytes=%s",
        r.status_code,
        len(r.content or b""),
    )
    if r.status_code >= 400:
        try:
            r.raise_for_status()
        except Exception as e:
            azure_vi_line(
                "VI JWT: ARM generateAccessToken HTTP error — %s",
                brief_exception_for_fallback(e),
            )
            logger.error(
                "Azure VI: ARM generateAccessToken failed — %s",
                brief_exception_for_fallback(e),
            )
            raise RuntimeError(
                brief_exception_for_fallback(e),
            ) from e
    try:
        data = r.json()
    except json.JSONDecodeError as e:
        azure_vi_line("VI JWT: ARM generateAccessToken response not JSON")
        raise RuntimeError(
            "ARM generateAccessToken returned non-JSON body",
        ) from e
    access = data.get("accessToken")
    if not access or not isinstance(access, str):
        azure_vi_line("VI JWT: response missing accessToken")
        raise RuntimeError("ARM generateAccessToken response missing accessToken")
    azure_vi_line("VI JWT: OK (Video Indexer account=%s)", name)
    logger.info(
        "Azure VI: ARM generateAccessToken OK (Video Indexer account=%s)",
        name,
    )
    return access


def get_video_indexer_access_token() -> str:
    """Cached Video Indexer JWT used with api.videoindexer.ai (never logged)."""
    global _cached_vi_token
    _diag_print("get_video_indexer_access_token: entered (first line)")
    now = time.time()

    _diag_print("get_video_indexer_access_token: before _token_lock acquire (read VI cache)")
    with _token_lock:
        _diag_print("get_video_indexer_access_token: after _token_lock acquired (read VI cache)")
        if _cached_vi_token and _cached_vi_token[1] > now + 30:
            azure_vi_line("VI token cache: HIT (using in-memory JWT)")
            _diag_print("get_video_indexer_access_token: VI cache HIT — return")
            return _cached_vi_token[0]
        azure_vi_line("VI token cache: miss — refreshing ARM + VI JWT chain")
    _diag_print("get_video_indexer_access_token: lock released after VI cache miss")

    arm = get_arm_access_token()
    vi = _generate_video_indexer_access_token(arm)
    ttl = _token_valid_until(vi, 45 * 60)

    _diag_print("get_video_indexer_access_token: before _token_lock acquire (write VI cache)")
    with _token_lock:
        _diag_print("get_video_indexer_access_token: after _token_lock acquired (write VI cache)")
        now2 = time.time()
        if _cached_vi_token and _cached_vi_token[1] > now2 + 30:
            _diag_print("get_video_indexer_access_token: peer refreshed VI cache — return cached")
            return _cached_vi_token[0]
        _cached_vi_token = (vi, ttl)
    _diag_print("get_video_indexer_access_token: lock released (VI cache stored)")

    azure_vi_line(
        "VI token cache: stored (ttl ~%ss)",
        int(ttl - now),
    )
    logger.info(
        "Video Indexer access token refreshed (cache until ~%s)",
        int(ttl - now),
    )
    return vi


_diag_print(f"module import complete ({__file__})")
