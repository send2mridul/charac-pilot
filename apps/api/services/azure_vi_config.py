"""Environment-driven settings for Azure AI Video Indexer (CastWeave import path)."""

from __future__ import annotations

import os
from functools import lru_cache

# Required for ARM + api.videoindexer.ai URL path (values never logged).
_REQUIRED_ENV_KEYS: tuple[str, ...] = (
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_RESOURCE_GROUP",
    "AZURE_VIDEO_INDEXER_ACCOUNT_NAME",
    "AZURE_VIDEO_INDEXER_ACCOUNT_ID",
    "AZURE_VIDEO_INDEXER_REGION",
)


@lru_cache
def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def missing_required_env_keys() -> list[str]:
    """Names of required env vars that are unset or blank (no values)."""
    return [k for k in _REQUIRED_ENV_KEYS if not _env(k)]


def azure_config_presence_summary() -> dict[str, bool]:
    """Which required keys are set — safe to log (booleans only)."""
    return {k: bool(_env(k)) for k in _REQUIRED_ENV_KEYS}


def azure_video_indexer_configured() -> bool:
    """True when required Azure VI settings are present (storage optional for URL upload)."""
    return not missing_required_env_keys()


def startup_log_line() -> str:
    """One line for API startup: configured or list of missing key names (no secrets)."""
    missing = missing_required_env_keys()
    if not missing:
        return "Azure Video Indexer env: OK (all required keys present)"
    return (
        "Azure Video Indexer env: incomplete; missing "
        + ", ".join(missing)
        + " - import will use local transcription until set (restart API after .env changes)"
    )


def subscription_id() -> str:
    return _env("AZURE_SUBSCRIPTION_ID")


def resource_group() -> str:
    return _env("AZURE_RESOURCE_GROUP")


def account_name() -> str:
    return _env("AZURE_VIDEO_INDEXER_ACCOUNT_NAME")


def account_id() -> str:
    return _env("AZURE_VIDEO_INDEXER_ACCOUNT_ID")


def region() -> str:
    """API location segment, e.g. centralindia."""
    return _env("AZURE_VIDEO_INDEXER_REGION").lower()


def arm_api_version() -> str:
    return _env("AZURE_VIDEO_INDEXER_ARM_API_VERSION", "2025-04-01")


def storage_account_name() -> str:
    """Optional: reserved for future blob-first upload flows."""
    return _env("AZURE_STORAGE_ACCOUNT_NAME")


def poll_interval_sec() -> float:
    try:
        return max(2.0, float(_env("AZURE_VIDEO_INDEXER_POLL_INTERVAL_SEC", "5")))
    except ValueError:
        return 5.0


def poll_timeout_sec() -> float:
    try:
        return max(30.0, float(_env("AZURE_VIDEO_INDEXER_POLL_TIMEOUT_SEC", "3600")))
    except ValueError:
        return 3600.0


def azure_allow_managed_identity() -> bool:
    """
    When True, use DefaultAzureCredential including Managed Identity (Azure hosts).

    When False (typical local Windows dev), Managed Identity is skipped so the chain
    does not block on IMDS. Override with AZURE_USE_MANAGED_IDENTITY=true|false.
    """
    v = _env("AZURE_USE_MANAGED_IDENTITY").lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    if _env("WEBSITE_SITE_NAME") or _env("IDENTITY_ENDPOINT") or _env("MSI_ENDPOINT"):
        return True
    return False


def arm_get_token_timeout_sec() -> float:
    """Wall-clock cap for credential.get_token(ARM scope)."""
    raw = _env("AZURE_ARM_GET_TOKEN_TIMEOUT_SEC")
    if raw:
        try:
            return max(15.0, float(raw))
        except ValueError:
            pass
    # Local (no MI): shorter default so jobs do not sit at running as long.
    return 90.0 if azure_allow_managed_identity() else 45.0


def vi_token_acquire_total_timeout_sec() -> float:
    """Outer cap for entire get_video_indexer_access_token (pool in video_indexer_service)."""
    raw = _env("AZURE_VI_TOKEN_ACQUIRE_TIMEOUT_SEC")
    if raw:
        try:
            return max(30.0, float(raw))
        except ValueError:
            pass
    return 150.0 if azure_allow_managed_identity() else 75.0


def arm_generate_token_http_timeout_sec() -> float:
    """HTTP timeout for ARM generateAccessToken POST."""
    try:
        return max(15.0, float(_env("AZURE_ARM_GENERATE_TOKEN_HTTP_TIMEOUT_SEC", "60")))
    except ValueError:
        return 60.0
