from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from schemas.character import CharacterOut
from schemas.episode import EpisodeCreateResult, EpisodeOut
from schemas.project import ProjectCreate, ProjectOut
from services import character_service, episode_service, job_service, project_service
from services.episode_media_worker import schedule_episode_processing
from storage_paths import UPLOADS_ROOT, ensure_storage_dirs

router = APIRouter()

_VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}


@router.get("", response_model=list[ProjectOut])
def list_projects():
    return project_service.list_projects()


@router.post("", response_model=ProjectOut)
def create_project(body: ProjectCreate):
    return project_service.create_project(body)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str):
    p = project_service.get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


@router.get("/{project_id}/episodes", response_model=list[EpisodeOut])
def list_episodes(project_id: str):
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return episode_service.list_episodes(project_id)


@router.post("/{project_id}/episodes/upload", response_model=EpisodeCreateResult)
async def upload_episode(project_id: str, file: UploadFile = File(...)):
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    orig = Path(file.filename)
    suffix = orig.suffix.lower()
    if suffix not in _VIDEO_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video type ({suffix or 'none'}). "
            f"Allowed: {', '.join(sorted(_VIDEO_SUFFIXES))}",
        )

    ensure_storage_dirs()
    title = orig.stem or "Uploaded episode"
    ep = episode_service.create_upload_episode(project_id, title)
    episode_id = ep.id

    episode_dir = UPLOADS_ROOT / project_id / episode_id
    episode_dir.mkdir(parents=True, exist_ok=True)
    dest = episode_dir / f"source{suffix}"

    try:
        with dest.open("wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                buffer.write(chunk)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not save upload: {e}") from e

    job_out = job_service.create_episode_media_job(
        project_id,
        episode_id,
        file.filename,
    )
    schedule_episode_processing(job_out.id, episode_id, project_id, dest)

    return EpisodeCreateResult(
        job_id=job_out.id,
        episode_id=episode_id,
        project_id=project_id,
        message=f"Upload saved; processing started ({job_out.id})",
    )


@router.get("/{project_id}/characters", response_model=list[CharacterOut])
def list_characters(project_id: str):
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return character_service.list_characters(project_id)
