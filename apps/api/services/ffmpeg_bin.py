"""
Resolve ffmpeg / ffprobe executables.

IDEs and GUI-launched processes on Windows often inherit a shorter PATH than
`cmd.exe` / PowerShell, so `shutil.which` can fail even when tools work in a
fresh terminal. We merge PATH with values read from the Windows registry and
support explicit overrides via environment variables.
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
from pathlib import Path

logger = logging.getLogger("characpilot.ffmpeg")

_ENV_FFMPEG = "FFMPEG_PATH"
_ENV_FFPROBE = "FFPROBE_PATH"


def _read_winreg_path(hive_name: str, subkey: str, name: str = "Path") -> str:
    if sys.platform != "win32":
        return ""
    try:
        import winreg
    except ImportError:
        return ""

    try:
        hive = winreg.HKEY_CURRENT_USER if hive_name == "HKCU" else winreg.HKEY_LOCAL_MACHINE
        with winreg.OpenKey(hive, subkey) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return str(value).strip() if value else ""
    except OSError:
        return ""


def _augmented_path_string() -> str:
    """PATH for resolution: process PATH + typical Windows registry sources."""
    chunks: list[str] = []
    proc = os.environ.get("PATH", "")
    if proc.strip():
        chunks.append(proc)

    if sys.platform == "win32":
        u = _read_winreg_path("HKCU", r"Environment")
        if u:
            chunks.append(u)
        m = _read_winreg_path(
            "HKLM",
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        )
        if m:
            chunks.append(m)

    return os.pathsep.join(chunks)


def _resolved_pair() -> tuple[str | None, str | None]:
    search_path = _augmented_path_string()
    env_ffmpeg = os.environ.get(_ENV_FFMPEG, "").strip()
    env_ffprobe = os.environ.get(_ENV_FFPROBE, "").strip()

    ffmpeg: str | None = None
    ffprobe: str | None = None

    if env_ffmpeg:
        p = Path(env_ffmpeg)
        ffmpeg = str(p.resolve()) if p.is_file() else None
    if env_ffprobe:
        p = Path(env_ffprobe)
        ffprobe = str(p.resolve()) if p.is_file() else None

    if ffmpeg is None:
        ffmpeg = shutil.which("ffmpeg", path=search_path)
    if ffprobe is None:
        ffprobe = shutil.which("ffprobe", path=search_path)

    if ffmpeg and ffprobe is None:
        sibling = Path(ffmpeg).parent / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
        if sibling.is_file():
            ffprobe = str(sibling.resolve())
    if ffprobe and ffmpeg is None:
        sibling = Path(ffprobe).parent / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
        if sibling.is_file():
            ffmpeg = str(sibling.resolve())

    return ffmpeg, ffprobe


def get_ffmpeg_paths() -> tuple[str, str]:
    """Return absolute paths to ffmpeg and ffprobe, or raise RuntimeError."""
    ffmpeg, ffprobe = _resolved_pair()
    if ffmpeg and ffprobe:
        return ffmpeg, ffprobe

    proc_path = os.environ.get("PATH", "")
    augmented = _augmented_path_string()
    logger.error(
        "FFmpeg resolution failed: ffmpeg=%r ffprobe=%r "
        "(used shutil.which with augmented PATH; augmented len=%s)",
        ffmpeg,
        ffprobe,
        len(augmented),
    )
    logger.error("Process PATH (os.environ): %s", proc_path if proc_path else "(empty)")
    logger.error("Augmented PATH (full): %s", augmented if augmented else "(empty)")
    raise RuntimeError(
        "FFmpeg is not installed or not discoverable from this API process. "
        "Install FFmpeg, ensure ffmpeg and ffprobe are on PATH, or set "
        f"{_ENV_FFMPEG} and {_ENV_FFPROBE} to full paths, then restart the API. "
        "See apps/api/README.md."
    )


def log_ffmpeg_detection(root_logger: logging.Logger | None = None) -> None:
    """Log resolved binaries at startup (does not raise)."""
    log = root_logger or logger
    ffmpeg, ffprobe = _resolved_pair()
    if ffmpeg and ffprobe:
        log.info("FFmpeg OK: ffmpeg=%s ffprobe=%s", ffmpeg, ffprobe)
        return

    log.warning(
        "FFmpeg not available at startup — episode uploads will fail until "
        "ffmpeg/ffprobe are discoverable (PATH or %s / %s).",
        _ENV_FFMPEG,
        _ENV_FFPROBE,
    )
    log.warning(
        "Startup PATH (os.environ): %s",
        os.environ.get("PATH", "") or "(empty)",
    )
    log.warning(
        "Augmented PATH (registry merge): %s",
        _augmented_path_string() or "(empty)",
    )
