import io
import logging
import shutil
import uuid
import zipfile

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from db.store import store
from schemas.character import (
    AssignVoiceBody,
    BatchGeneratedClipOut,
    CharacterOut,
    GenerateBody,
    GenerateClipsBody,
    GenerateClipsOut,
    GeneratePreviewBody,
    PatchCharacterBody,
    PreviewOut,
)
from schemas.job import JobOut
from schemas.voice_clip import VoiceClipOut
from services import character_service, job_service
from services.character_avatar import save_character_avatar_file
from services.tts_service import generate_preview
from services.voice_clip_service import list_for_character
from storage_paths import STORAGE_ROOT, ensure_storage_dirs, to_rel_storage_path

router = APIRouter()
log = logging.getLogger("characpilot.characters")


def _prompt_to_lines(prompt: str, count: int) -> list[str]:
    seed = " ".join(prompt.strip().split())
    if not seed:
        return []
    safe_count = max(1, min(count, 12))
    lines: list[str] = []
    for i in range(safe_count):
        lines.append(f"{seed} ({i + 1})")
    return lines


# --- Register all /{character_id}/... subpaths before bare /{character_id} (GET/PATCH).


@router.get("/{character_id}/clips", response_model=list[VoiceClipOut])
def list_character_clips(character_id: str):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return list_for_character(character_id)


@router.get("/{character_id}/clips/download-all")
def download_character_clips_zip(character_id: str):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    rows = store.list_voice_clips_for_character(character_id)
    if not rows:
        raise HTTPException(status_code=404, detail="No clips for this character yet")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, rec in enumerate(rows):
            path = STORAGE_ROOT / rec.audio_path
            if not path.is_file():
                continue
            safe = "".join(
                ch if ch.isalnum() or ch in "._- " else "_" for ch in (rec.title or rec.id)
            ).strip()[:48] or rec.id
            ext = path.suffix or ".wav"
            zf.write(path, arcname=f"{i + 1:03d}_{safe}{ext}")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="castvoice-clips-{character_id}.zip"',
        },
    )


@router.post("/{character_id}/avatar", response_model=CharacterOut)
async def upload_character_avatar(character_id: str, file: UploadFile = File(...)):
    return await save_character_avatar_file(character_id, file)


@router.post("/{character_id}/voice", response_model=CharacterOut)
def assign_voice(character_id: str, body: AssignVoiceBody):
    """Save a voice from the catalog (or custom ID) as the character's default voice."""
    log.info("POST /characters/%s/voice voice_id=%s", character_id, body.voice_id)
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    st = body.voice_source_type or "catalog"
    extra: dict = {
        "default_voice_id": body.voice_id,
        "voice_display_name": body.display_name or body.voice_id,
        "voice_source_type": st,
    }
    if st == "catalog":
        extra["voice_provider"] = body.provider or "catalog"
        extra["voice_parent_id"] = None
        extra["voice_description_meta"] = None
    else:
        extra["voice_provider"] = body.provider or "elevenlabs"
    updated = character_service.update_character(character_id, **extra)
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


@router.post("/{character_id}/generate", response_model=JobOut)
def queue_generate(character_id: str, _body: GenerateBody | None = None):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return job_service.create_generate_job(character_id)


@router.post("/{character_id}/generate-preview", response_model=PreviewOut)
def generate_preview_endpoint(character_id: str, body: GeneratePreviewBody):
    log.info("POST /characters/%s/generate-preview text=%s", character_id, body.text[:80])
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    try:
        result = generate_preview(
            character_id=character_id,
            text=body.text,
            voice_id=body.voice_id or c.default_voice_id,
            style=body.style,
        )
    except Exception as e:
        log.exception("generate-preview failed character_id=%s", character_id)
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e

    clip_id: str | None = None
    audio_url = result["audio_url"]
    rel_preview = str(result.get("audio_relpath") or "")

    if body.save_clip and rel_preview:
        src = STORAGE_ROOT / rel_preview
        if src.is_file():
            ensure_storage_dirs()
            clip_uid = f"vcp-{uuid.uuid4().hex[:12]}"
            clip_dir = STORAGE_ROOT / "clips" / character_id
            clip_dir.mkdir(parents=True, exist_ok=True)
            ext = src.suffix or ".wav"
            dest = clip_dir / f"{clip_uid}{ext}"
            shutil.copy2(src, dest)
            clip_rel = to_rel_storage_path(dest)
            vid = (body.voice_id or c.default_voice_id) or ""
            vname = (c.voice_display_name or "") if c else ""
            hint = (body.style or "").strip()
            title_raw = (body.clip_title or "").strip()
            title = title_raw or f"Line {clip_uid[-4:]}"
            rec = store.create_voice_clip(
                character_id=character_id,
                project_id=c.project_id,
                voice_id=vid,
                voice_name=vname,
                text=body.text,
                tone_style_hint=hint,
                audio_path=clip_rel,
                title=title,
            )
            clip_id = rec.id
            audio_url = f"/media/{clip_rel}"

    character_service.update_character(character_id, preview_audio_path=audio_url)
    return PreviewOut(
        preview_id=result["preview_id"],
        character_id=result["character_id"],
        audio_url=audio_url,
        duration_ms=result["duration_ms"],
        text=result["text"],
        provider=result["provider"],
        clip_id=clip_id,
    )


@router.post("/{character_id}/generate-clips", response_model=GenerateClipsOut)
def generate_clips_endpoint(character_id: str, body: GenerateClipsBody):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    voice_id = body.voice_id or c.default_voice_id
    if not voice_id:
        raise HTTPException(status_code=400, detail="Assign a voice first")

    mode = (body.mode or "multi_line").strip().lower()
    if mode not in {"multi_line", "prompt"}:
        raise HTTPException(status_code=400, detail="Unsupported mode")

    source_lines: list[str]
    if mode == "prompt":
        source_lines = _prompt_to_lines(body.prompt or "", body.count)
    else:
        source_lines = [ln.strip() for ln in (body.lines or []) if ln.strip()]

    if not source_lines:
        raise HTTPException(status_code=400, detail="No clip text provided")

    ensure_storage_dirs()
    prefix = (body.clip_label_prefix or "").strip()
    style = (body.style or "").strip()
    created: list[BatchGeneratedClipOut] = []
    provider_used = "stub"

    for idx, line in enumerate(source_lines, start=1):
        result = generate_preview(
            character_id=character_id,
            text=line,
            voice_id=voice_id,
            style=style or None,
        )
        provider_used = str(result.get("provider") or provider_used)
        rel_preview = str(result.get("audio_relpath") or "")
        src = STORAGE_ROOT / rel_preview
        if not src.is_file():
            continue
        clip_uid = f"vcp-{uuid.uuid4().hex[:12]}"
        clip_dir = STORAGE_ROOT / "clips" / character_id
        clip_dir.mkdir(parents=True, exist_ok=True)
        ext = src.suffix or ".wav"
        dest = clip_dir / f"{clip_uid}{ext}"
        shutil.copy2(src, dest)
        clip_rel = to_rel_storage_path(dest)
        vname = (c.voice_display_name or "") if c else ""
        if prefix:
            title = f"{prefix} {idx}"
        else:
            title = f"Clip {idx}"
        rec = store.create_voice_clip(
            character_id=character_id,
            project_id=c.project_id,
            voice_id=voice_id,
            voice_name=vname,
            text=line,
            tone_style_hint=style,
            audio_path=clip_rel,
            title=title,
        )
        created.append(
            BatchGeneratedClipOut(
                clip_id=rec.id,
                title=rec.title,
                text=rec.text,
                audio_url=f"/media/{rec.audio_path}",
                tone_style_hint=rec.tone_style_hint,
                created_at=rec.created_at,
            )
        )

    if not created:
        raise HTTPException(status_code=500, detail="Could not generate clips")

    character_service.update_character(character_id, preview_audio_path=created[-1].audio_url)
    return GenerateClipsOut(
        character_id=character_id,
        mode=mode,
        provider=provider_used,
        generated_count=len(created),
        clips=created,
    )


@router.patch("/{character_id}", response_model=CharacterOut)
def patch_character(character_id: str, body: PatchCharacterBody):
    log.info("PATCH /characters/%s body=%s", character_id, body.model_dump(exclude_none=True))
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


@router.get("/{character_id}", response_model=CharacterOut)
def get_character(character_id: str):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    return c
