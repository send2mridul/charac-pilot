import logging
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile

from schemas.character import (
    CharacterOut,
    CreateManualCharacterBody,
    PatchCharacterBody,
)
from services.character_avatar import save_character_avatar_file
from schemas.episode import EpisodeCreateResult, EpisodeOut
from schemas.project import ProjectCreate, ProjectOut, ProjectPatch
from schemas.voice_clip import VoiceClipOut
from services import character_service, episode_service, job_service, project_service
from services.voice_clip_service import list_for_project
from services.episode_media_worker import schedule_episode_processing
from services.job_timing import (
    job_timing_ensure_start,
    job_timing_set_upload_save_sec,
)
from storage_paths import UPLOADS_ROOT, ensure_storage_dirs

router = APIRouter()
logger = logging.getLogger(__name__)

_VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}


@router.get("", response_model=list[ProjectOut])
def list_projects():
    return project_service.list_projects()


@router.post("", response_model=ProjectOut)
def create_project(body: ProjectCreate):
    return project_service.create_project(body)


def _delete_project_response(project_id: str) -> Response:
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    project_service.delete_project(project_id)
    return Response(status_code=204)


@router.post("/delete/{project_id}", status_code=204)
def post_delete_project_path_prefix(project_id: str):
    """Same as POST /{project_id}/delete; alternate URL for strict proxies and older clients."""
    return _delete_project_response(project_id)


# --- More specific /{project_id}/... routes first, then mutating verbs, then GET by id.
#    Order avoids edge cases where some stacks mishandle method routing for the same path.


@router.get("/{project_id}/clips", response_model=list[VoiceClipOut])
def list_project_clips(project_id: str):
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return list_for_project(project_id)


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

    job_out = job_service.create_episode_media_job(
        project_id,
        episode_id,
        file.filename,
    )
    job_timing_ensure_start(job_out.id)
    logger.info(
        "[characpilot] JOB TIMING job_id=%s phase=upload_received filename=%s",
        job_out.id,
        file.filename,
    )

    t_disk0 = time.perf_counter()
    try:
        with dest.open("wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                buffer.write(chunk)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not save upload: {e}") from e
    disk_write_sec = time.perf_counter() - t_disk0
    job_timing_set_upload_save_sec(job_out.id, disk_write_sec)
    logger.info(
        "[characpilot] JOB TIMING job_id=%s phase=file_saved sec=%.3f",
        job_out.id,
        disk_write_sec,
    )

    nbytes = dest.stat().st_size if dest.is_file() else 0
    logger.info(
        "castweave_upload_timing job_id=%s episode_id=%s project_id=%s disk_write_sec=%.3f size_bytes=%s",
        job_out.id,
        episode_id,
        project_id,
        disk_write_sec,
        nbytes,
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


@router.post("/{project_id}/characters", response_model=CharacterOut)
def create_character_manual(project_id: str, body: CreateManualCharacterBody):
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return character_service.create_manual_character(
        project_id,
        body.name,
        body.role or "",
        body.wardrobe_notes or "",
    )


@router.patch("/{project_id}/characters/{character_id}", response_model=CharacterOut)
def patch_character(project_id: str, character_id: str, body: PatchCharacterBody):
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        c = character_service.get_character(character_id)
        if not c:
            raise HTTPException(status_code=404, detail="Character not found")
        return c
    updated = character_service.update_character(character_id, **updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


@router.post("/{project_id}/characters/{character_id}/avatar", response_model=CharacterOut)
async def upload_character_avatar_under_project(
    project_id: str, character_id: str, file: UploadFile = File(...)
):
    if not project_service.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    ch = character_service.get_character(character_id)
    if not ch or ch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Character not found")
    return await save_character_avatar_file(character_id, file)


@router.post("/{project_id}/update", response_model=ProjectOut)
def post_update_project(project_id: str, body: ProjectPatch):
    """POST fallback when PATCH/PUT are blocked (some proxies or older stacks return 405)."""
    updated = project_service.update_project(project_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.post("/{project_id}/delete", status_code=204)
def post_delete_project(project_id: str):
    """POST fallback when DELETE is blocked."""
    return _delete_project_response(project_id)


@router.patch("/{project_id}", response_model=ProjectOut)
def patch_project(project_id: str, body: ProjectPatch):
    updated = project_service.update_project(project_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.put("/{project_id}", response_model=ProjectOut)
def put_project(project_id: str, body: ProjectPatch):
    """Same as PATCH. Some clients send PUT; this avoids 405 Method Not Allowed."""
    updated = project_service.update_project(project_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.delete("/{project_id}", status_code=204)
def remove_project(project_id: str):
    return _delete_project_response(project_id)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str):
    p = project_service.get_project(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p
