"""Per-job wall-clock accumulators for compact import timing summaries (thread-safe)."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_lock = threading.Lock()
# job_id -> {"t0": float, "upload": float, "parts": dict[str, float]}
_state: dict[str, dict[str, Any]] = {}


def job_timing_ensure_start(job_id: str) -> None:
    """Start wall clock for a job (idempotent). Call when the job row is created."""
    with _lock:
        if job_id not in _state:
            _state[job_id] = {
                "t0": time.perf_counter(),
                "upload": 0.0,
                "parts": {},
            }


def job_timing_set_upload_save_sec(job_id: str, seconds: float) -> None:
    """HTTP body saved to disk duration (router)."""
    job_timing_ensure_start(job_id)
    with _lock:
        st = _state.get(job_id)
        if st is not None:
            st["upload"] = max(0.0, float(seconds))


def job_timing_add_phase(job_id: str, key: str, seconds: float) -> None:
    job_timing_ensure_start(job_id)
    sec = max(0.0, float(seconds))
    with _lock:
        st = _state.get(job_id)
        if st is None:
            return
        parts: dict[str, float] = st["parts"]
        parts[key] = parts.get(key, 0.0) + sec
    logger.info(
        "[characpilot] JOB TIMING job_id=%s phase=%s sec=%.3f",
        job_id,
        key,
        sec,
    )


def job_timing_discard(job_id: str) -> None:
    with _lock:
        _state.pop(job_id, None)


def job_timing_log_summary(job_id: str) -> None:
    """One scan-friendly line with per-stage breakdown; removes stored state for this job_id."""
    with _lock:
        data = _state.pop(job_id, None)
    if not data:
        return
    total = time.perf_counter() - float(data["t0"])
    upload = float(data["upload"])
    parts: dict[str, float] = data["parts"]

    def p(key: str) -> float:
        return float(parts.get(key, 0.0))

    extract = p("extract")
    thumbnails = p("thumbnails")
    analysis = p("analysis")
    mapping = p("mapping")
    grouping = p("grouping")
    persist = p("persist")
    fallback = p("fallback")

    logger.info(
        "JOB TIMING SUMMARY job_id=%s total=%.2fs upload=%.2fs "
        "extract=%.2fs thumbnails=%.2fs analysis=%.2fs mapping=%.2fs grouping=%.2fs "
        "persist=%.2fs fallback=%.2fs",
        job_id,
        total,
        upload,
        extract,
        thumbnails,
        analysis,
        mapping,
        grouping,
        persist,
        fallback,
    )

    overhead = max(0.0, total - upload - extract - thumbnails - analysis - mapping - grouping - persist - fallback)
    logger.info(
        "JOB TIMING BREAKDOWN job_id=%s | upload %.1fs | extract %.1fs | "
        "thumbnails %.1fs | analysis %.1fs | mapping %.1fs | grouping %.1fs | "
        "persist %.1fs | fallback %.1fs | overhead %.1fs | TOTAL %.1fs",
        job_id, upload, extract, thumbnails, analysis, mapping, grouping,
        persist, fallback, overhead, total,
    )
