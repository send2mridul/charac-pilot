"""Azure Video Indexer diagnostics: always print to stdout + log (survives uvicorn logging quirks)."""

from __future__ import annotations

import logging
import sys

PREFIX = "[characpilot] Azure VI:"

_azure_logger = logging.getLogger("characpilot.azure_vi")


def azure_vi_line(msg: str, *args: object) -> None:
    """Print (flush) and log at INFO. Use for every Azure runtime step."""
    text = msg % args if args else msg
    print(f"{PREFIX} {text}", flush=True, file=sys.stdout)
    if args:
        _azure_logger.info(msg, *args)
    else:
        _azure_logger.info("%s", text)


def azure_vi_exception(msg: str, exc: BaseException) -> None:
    """Print + log exception with traceback (worker thread safe)."""
    print(f"{PREFIX} {msg}: {exc!r}", flush=True, file=sys.stdout)
    _azure_logger.exception("%s", msg)
