"""CharacPilot API entrypoint."""

import logging
from pathlib import Path

from dotenv import load_dotenv

# Load apps/api/.env for local dev (never commit secrets)
load_dotenv(Path(__file__).resolve().parent / ".env")
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import characters, episodes, health, jobs, projects, voices
from services.ffmpeg_bin import log_ffmpeg_detection
from storage_paths import STORAGE_ROOT, ensure_storage_dirs

log = logging.getLogger("characpilot")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log_ffmpeg_detection(log)
    yield


app = FastAPI(
    title="CharacPilot API",
    version="0.1.0",
    description="CharacPilot API — in-memory data, local media under /media.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
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

STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(STORAGE_ROOT)), name="media")
