"""CastVoice API entrypoint (CharacPilot codebase)."""

import logging
from pathlib import Path

from dotenv import load_dotenv

# Local dev — never commit secrets. Repo root .env first, then apps/api/.env (overrides).
_api_dir = Path(__file__).resolve().parent
_root_dir = _api_dir.parent.parent
load_dotenv(_root_dir / ".env")
load_dotenv(_api_dir / ".env", override=True)
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import characters, clips, episodes, health, jobs, projects, voices
from services.ffmpeg_bin import log_ffmpeg_detection
from storage_paths import STORAGE_ROOT, ensure_storage_dirs

log = logging.getLogger("characpilot")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log_ffmpeg_detection(log)
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
