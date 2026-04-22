"""Wall-clock timing helpers for episode import (structured logs per job)."""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


class ImportStageTimer:
    """Logs elapsed time per pipeline stage with a stable job_id prefix."""

    __slots__ = ("job_id", "_t0", "_last")

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self._t0 = time.perf_counter()
        self._last = self._t0

    def mark(self, stage: str) -> None:
        now = time.perf_counter()
        stage_sec = now - self._last
        total_sec = now - self._t0
        logger.info(
            "castweave_import_timing job_id=%s stage=%s stage_sec=%.3f total_sec=%.3f",
            self.job_id,
            stage,
            stage_sec,
            total_sec,
        )
        self._last = now

    def total_sec(self) -> float:
        return time.perf_counter() - self._t0
