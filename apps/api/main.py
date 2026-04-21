"""CastVoice API entrypoint (CharacPilot codebase)."""

import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

# Local dev — never commit secrets. Repo root .env first, then apps/api/.env (overrides).
_api_dir = Path(__file__).resolve().parent
_root_dir = _api_dir.parent.parent
load_dotenv(_root_dir / ".env")
load_dotenv(_api_dir / ".env", override=True)

from services import azure_vi_config


class _FlushingStreamHandler(logging.StreamHandler):
    """Flush after each record so lines show up under npm/concurrently on Windows."""

    def emit(self, record: logging.LogRecord) -> None:
        super().emit(record)
        self.flush()


def _configure_logging() -> None:
    """First import: best-effort (uvicorn may replace this later)."""
    _apply_console_logging(force=False)


def _apply_console_logging(*, force: bool) -> None:
    """
    Attach a single INFO handler on the root logger.

    Uvicorn calls logging.config.dictConfig() when the worker starts, which clears handlers
    set at import time — so we must call again from lifespan with force=True.
    """
    fmt = "%(levelname)s [%(name)s] %(message)s"
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(line_buffering=True)
        except OSError:
            pass
    if force:
        root.handlers.clear()
    if not root.handlers:
        h = _FlushingStreamHandler(sys.stdout)
        h.setFormatter(logging.Formatter(fmt))
        root.addHandler(h)
    for name in ("characpilot", "characpilot.azure_vi"):
        lg = logging.getLogger(name)
        lg.setLevel(logging.INFO)
        lg.propagate = True
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "watchfiles"):
        logging.getLogger(name).setLevel(logging.INFO)
    for name in ("httpx", "httpcore", "azure.core.pipeline.policies.http_logging_policy"):
        logging.getLogger(name).setLevel(logging.WARNING)


_configure_logging()

import threading


def _thread_excepthook(args: threading.ExceptHookArgs) -> None:
    """Daemon worker threads otherwise swallow exceptions; print + log to the API terminal."""
    print(
        f"[characpilot] UNCAUGHT in thread {getattr(args.thread, 'name', '?')!r}: "
        f"{args.exc_type.__name__ if args.exc_type else '?'}"
        f": {args.exc_value}",
        flush=True,
        file=sys.stderr,
    )
    logging.getLogger("characpilot").error(
        "Uncaught exception in thread %s",
        getattr(args.thread, "name", None),
        exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
    )
    sys.__excepthook__(args.exc_type, args.exc_value, args.exc_traceback)


threading.excepthook = _thread_excepthook


def _print_characpilot_startup_banner(phase: str) -> None:
    """Obvious multi-line block for the uvicorn terminal (stdout, flushed)."""
    root = logging.getLogger()
    handlers_ok = bool(root.handlers)
    azure_ok = azure_vi_config.azure_video_indexer_configured()
    keys = azure_vi_config.azure_config_presence_summary()
    bar = "=" * 72
    print(bar, flush=True)
    print(f"[characpilot] STARTUP ({phase})", flush=True)
    print("[characpilot] env: dotenv loaded (repo root .env then apps/api/.env override)", flush=True)
    print(f"[characpilot] Azure VI configured (all required keys): {azure_ok}", flush=True)
    print(f"[characpilot] Azure VI key presence (names only): {keys}", flush=True)
    print(
        f"[characpilot] Azure ARM credential: allow_managed_identity="
        f"{azure_vi_config.azure_allow_managed_identity()} "
        "(False = local-style: Azure CLI first, no IMDS; True = full DefaultAzureCredential)",
        flush=True,
    )
    print(f"[characpilot] root logging handler attached: {handlers_ok}", flush=True)
    print(
        "[characpilot] worker + Azure path: logs → this terminal; "
        "Azure steps prefixed with [characpilot] Azure VI:",
        flush=True,
    )
    print(bar, flush=True)


_print_characpilot_startup_banner("import — before uvicorn")

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request

from routers import characters, clips, episodes, health, jobs, projects, voices
from services.ffmpeg_bin import log_ffmpeg_detection
from storage_paths import STORAGE_ROOT, ensure_storage_dirs

log = logging.getLogger("characpilot")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Uvicorn overwrites logging config after main.py is imported; restore before any requests.
    _apply_console_logging(force=True)
    _print_characpilot_startup_banner("lifespan — after uvicorn log reconfigure")
    log.info("Logging reconfigured for worker (uvicorn-compatible); HTTP lines use [characpilot].")
    log_ffmpeg_detection(log)
    log.info(
        "Env: loaded from repo root .env then apps/api/.env (override). %s",
        azure_vi_config.startup_log_line(),
    )
    log.info(
        "Azure VI env key presence (no values): %s",
        azure_vi_config.azure_config_presence_summary(),
    )
    yield


app = FastAPI(
    title="CastVoice API",
    version="0.1.0",
    description="CastVoice API. SQLite metadata and local media under /media.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _log_http_requests(request: Request, call_next):
    """Log every request. Uses print(flush=True) so lines show under concurrently/npm on Windows even if uvicorn resets logging."""
    path = request.url.path
    print(f"[characpilot] HTTP {request.method} {path}", flush=True)
    log.info("HTTP %s %s", request.method, path)
    try:
        response = await call_next(request)
    except Exception:
        print(
            f"[characpilot] HTTP {request.method} {path} -> ERROR",
            flush=True,
        )
        log.exception("HTTP %s %s failed", request.method, path)
        raise
    print(
        f"[characpilot] HTTP {request.method} {path} -> {response.status_code}",
        flush=True,
    )
    log.info("HTTP %s %s -> %s", request.method, path, response.status_code)
    return response


ensure_storage_dirs()

app.include_router(health.router, tags=["health"])
app.include_router(projects.router, prefix="/projects", tags=["projects"])
app.include_router(characters.router, prefix="/characters", tags=["characters"])
app.include_router(episodes.router, prefix="/episodes", tags=["episodes"])
app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(voices.router, prefix="/voices", tags=["voices"])
app.include_router(clips.router, prefix="/clips", tags=["clips"])

STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(STORAGE_ROOT)), name="media")
