"""User-tunable import behavior (env-driven, no secrets).

Env vars (all optional):
  CASTWEAVE_MAX_UPLOAD_MB           - max upload file size in MB (default 500)
  CASTWEAVE_MAX_DURATION_SEC        - max media duration in seconds (default 1800 = 30 min)
  CASTWEAVE_MAX_CONCURRENT_JOBS     - max parallel heavy processing threads (default 1)
  CASTWEAVE_EPISODE_MEDIA_MAX_SEC   - wall-clock timeout for entire pipeline (default 5400)
  CASTWEAVE_IMPORT_LOCAL_FIRST_MAX_SEC - skip remote VI for clips shorter than this (default 120)
"""

from __future__ import annotations

import os
from functools import lru_cache


@lru_cache
def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def local_first_max_duration_sec() -> float | None:
    """
    When set to a positive number, skip remote AI video analysis for clips whose
    duration (seconds) is at most this value, and use on-device analysis instead.

    CASTWEAVE_IMPORT_LOCAL_FIRST_MAX_SEC:
      - unset or invalid: default 120 (2 minutes)
      - 0 or negative: disable (always use remote when configured)
    """
    raw = _env("CASTWEAVE_IMPORT_LOCAL_FIRST_MAX_SEC", "120")
    try:
        v = float(raw)
    except ValueError:
        v = 120.0
    if v <= 0:
        return None
    return v


def episode_media_max_wall_sec() -> float:
    """Hard cap for the whole episode_media worker run (fails job if exceeded)."""
    raw = _env("CASTWEAVE_EPISODE_MEDIA_MAX_SEC", "5400")
    try:
        return max(300.0, float(raw))
    except ValueError:
        return 5400.0


def max_media_duration_sec() -> float:
    """Reject uploads whose probed duration exceeds this (seconds). Default 30 min."""
    raw = _env("CASTWEAVE_MAX_DURATION_SEC", "1800")
    try:
        return max(60.0, float(raw))
    except ValueError:
        return 1800.0


def max_concurrent_jobs() -> int:
    """Max parallel heavy processing threads. Default 1 for memory safety."""
    raw = _env("CASTWEAVE_MAX_CONCURRENT_JOBS", "1")
    try:
        return max(1, int(raw))
    except ValueError:
        return 1
