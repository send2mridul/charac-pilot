import io
import logging
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import check_ownership, require_user_id
from db.store import store
from schemas.character import (
    AssignVoiceBody,
    BatchGeneratedClipOut,
    CharacterOut,
    ClipLineIn,
    DraftLineOut,
    GenerateBody,
    GenerateClipsBody,
    GenerateClipsOut,
    GenerateClipsFromLinesBody,
    GenerateDraftLinesOut,
    GenerateLinesBody,
    GenerateLinesOut,
    GeneratePreviewBody,
    PatchCharacterBody,
    PreviewOut,
)
from schemas.job import JobOut
from schemas.voice_clip import VoiceClipOut
from services import character_service, job_service
from services.character_avatar import save_character_avatar_file
from services.draft_line_generation import generate_draft_lines, generate_line_texts
from services.r2_storage import (
    download_file as r2_download,
    r2_configured,
    upload_local_and_clean,
)
from services.tts_service import generate_preview
from services.voice_clip_service import list_for_character
from storage_paths import STORAGE_ROOT, ensure_storage_dirs, to_rel_storage_path

router = APIRouter()
log = logging.getLogger("characpilot.characters")


class AvatarFromEpisodeThumbBody(BaseModel):
    episode_id: str = Field(..., min_length=1)
    thumb_index: int = Field(ge=0, le=11)


def _generate_and_store_clips(
    *,
    character_id: str,
    project_id: str,
    voice_id: str,
    voice_name: str,
    source_lines: list[ClipLineIn],
    default_style: str,
    clip_label_prefix: str,
) -> tuple[list[BatchGeneratedClipOut], str]:
    ensure_storage_dirs()
    created: list[BatchGeneratedClipOut] = []
    provider_used = "stub"
    prefix = clip_label_prefix.strip()

    for idx, line_in in enumerate(source_lines, start=1):
        text = (line_in.text or "").strip()
        if not text:
            continue
        result = generate_preview(
            character_id=character_id,
            text=text,
            voice_id=voice_id,
            style=None,
        )
        provider_used = str(result.get("provider") or provider_used)
        rel_preview = str(result.get("audio_relpath") or "")
        src = STORAGE_ROOT / rel_preview
        clip_uid = f"vcp-{uuid.uuid4().hex[:12]}"
        clip_dir = STORAGE_ROOT / "clips" / character_id
        clip_dir.mkdir(parents=True, exist_ok=True)
        ext_suffix = Path(rel_preview).suffix or ".wav"
        dest = clip_dir / f"{clip_uid}{ext_suffix}"

        if src.is_file():
            shutil.copy2(src, dest)
        elif r2_configured():
            from services.r2_storage import bucket_for_key
            ok = r2_download(bucket_for_key(rel_preview), rel_preview, dest)
            if not ok:
                continue
        else:
            continue

        clip_rel = to_rel_storage_path(dest)
        upload_local_and_clean(dest, clip_rel)
        if prefix:
            title = f"{prefix} {idx}"
        else:
            snippet = " ".join(text.split())[:36].strip()
            title = snippet if snippet else f"Clip {idx}"
        rec = store.create_voice_clip(
            character_id=character_id,
            project_id=project_id,
            voice_id=voice_id,
            voice_name=voice_name,
            text=text,
            tone_style_hint="",
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

    return created, provider_used


# --- Register all /{character_id}/... subpaths before bare /{character_id} (GET/PATCH).


@router.get("/{character_id}/clips", response_model=list[VoiceClipOut])
def list_character_clips(character_id: str, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    return list_for_character(character_id)


@router.get("/{character_id}/clips/download-all")
def download_character_clips_zip(character_id: str, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    from services.r2_storage import bucket_for_key, download_file as r2_dl, r2_configured as r2_on
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    rows = store.list_voice_clips_for_character(character_id)
    if not rows:
        raise HTTPException(status_code=404, detail="No clips for this character yet")
    buf = io.BytesIO()
    temp_files: list[Path] = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, rec in enumerate(rows):
            path = STORAGE_ROOT / rec.audio_path
            fetched = False
            if not path.is_file() and r2_on():
                path.parent.mkdir(parents=True, exist_ok=True)
                key = rec.audio_path.replace("\\", "/")
                if r2_dl(bucket_for_key(key), key, path):
                    temp_files.append(path)
                    fetched = True
            if not path.is_file():
                continue
            safe = "".join(
                ch if ch.isalnum() or ch in "._- " else "_" for ch in (rec.title or rec.id)
            ).strip()[:48] or rec.id
            ext = path.suffix or ".wav"
            zf.write(path, arcname=f"{i + 1:03d}_{safe}{ext}")
    for tp in temp_files:
        try:
            tp.unlink()
        except OSError:
            pass
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="castvoice-clips-{character_id}.zip"',
        },
    )


@router.post("/{character_id}/avatar", response_model=CharacterOut)
async def upload_character_avatar(character_id: str, file: UploadFile = File(...), user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    return await save_character_avatar_file(character_id, file)


@router.post("/{character_id}/voice", response_model=CharacterOut)
def assign_voice(character_id: str, body: AssignVoiceBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
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
        extra["voice_provider"] = body.provider or "primary"
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
def generate_preview_endpoint(character_id: str, body: GeneratePreviewBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    log.info("POST /characters/%s/generate-preview text=%s", character_id, body.text[:80])
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    try:
        result = generate_preview(
            character_id=character_id,
            text=body.text,
            voice_id=body.voice_id or c.default_voice_id,
            style=None,
        )
    except Exception as e:
        log.exception("generate-preview failed character_id=%s", character_id)
        raise HTTPException(
            status_code=500,
            detail="Audio engine is unavailable right now. Please try again.",
        ) from e

    clip_id: str | None = None
    audio_url = result["audio_url"]
    rel_preview = str(result.get("audio_relpath") or "")

    if body.save_clip and rel_preview:
        src = STORAGE_ROOT / rel_preview
        ensure_storage_dirs()
        clip_uid = f"vcp-{uuid.uuid4().hex[:12]}"
        clip_dir = STORAGE_ROOT / "clips" / character_id
        clip_dir.mkdir(parents=True, exist_ok=True)
        ext_s = Path(rel_preview).suffix or ".wav"
        dest = clip_dir / f"{clip_uid}{ext_s}"

        _copied = False
        if src.is_file():
            shutil.copy2(src, dest)
            _copied = True
        elif r2_configured():
            from services.r2_storage import bucket_for_key
            _copied = r2_download(bucket_for_key(rel_preview), rel_preview, dest)

        if _copied and dest.is_file():
            clip_rel = to_rel_storage_path(dest)
            upload_local_and_clean(dest, clip_rel)
            vid = (body.voice_id or c.default_voice_id) or ""
            vname = (c.voice_display_name or "") if c else ""
            hint = ""
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


@router.post("/{character_id}/generate-lines", response_model=GenerateLinesOut)
def generate_lines_endpoint(character_id: str, body: GenerateLinesBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    lines = generate_line_texts(prompt, body.count)
    if not lines:
        raise HTTPException(status_code=400, detail="Could not generate lines")

    return GenerateLinesOut(
        character_id=character_id,
        prompt=prompt,
        generated_count=len(lines),
        lines=lines,
    )


@router.post("/{character_id}/generate-draft-lines", response_model=GenerateDraftLinesOut)
def generate_draft_lines_endpoint(character_id: str, body: GenerateLinesBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    result = generate_draft_lines(prompt, body.count)
    if not result.lines:
        raise HTTPException(status_code=400, detail="Could not generate draft lines")

    structured = [
        DraftLineOut(order=line.order, text=line.text, tone_style=line.tone_style)
        for line in result.lines
    ]
    return GenerateDraftLinesOut(
        character_id=character_id,
        prompt=prompt,
        generated_count=len(structured),
        lines=structured,
        provider_used=result.provider_used,
        fallback_used=result.fallback_used,
    )


@router.post("/{character_id}/generate-clips", response_model=GenerateClipsOut)
def generate_clips_endpoint(character_id: str, body: GenerateClipsBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
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
        source_lines = generate_line_texts(body.prompt or "", body.count)
    else:
        source_lines = [ln.strip() for ln in (body.lines or []) if ln.strip()]

    if not source_lines:
        raise HTTPException(status_code=400, detail="No clip text provided")

    style = (body.style or "").strip()
    line_objs = [ClipLineIn(text=line, tone_style=style) for line in source_lines]
    created, provider_used = _generate_and_store_clips(
        character_id=character_id,
        project_id=c.project_id,
        voice_id=voice_id,
        voice_name=(c.voice_display_name or ""),
        source_lines=line_objs,
        default_style=style,
        clip_label_prefix=(body.clip_label_prefix or ""),
    )

    if not created:
        raise HTTPException(status_code=500, detail="Could not generate clips")

    return GenerateClipsOut(
        character_id=character_id,
        mode=mode,
        provider=provider_used,
        generated_count=len(created),
        clips=created,
    )


@router.post("/{character_id}/generate-clips-from-lines", response_model=GenerateClipsOut)
def generate_clips_from_lines_endpoint(character_id: str, body: GenerateClipsFromLinesBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    voice_id = body.voice_id or c.default_voice_id
    if not voice_id:
        raise HTTPException(status_code=400, detail="Assign a voice first")

    source_lines = [ln for ln in body.lines if (ln.text or "").strip()]
    if not source_lines:
        raise HTTPException(status_code=400, detail="No approved lines provided")

    created, provider_used = _generate_and_store_clips(
        character_id=character_id,
        project_id=c.project_id,
        voice_id=voice_id,
        voice_name=(c.voice_display_name or ""),
        source_lines=source_lines,
        default_style=(body.style or "").strip(),
        clip_label_prefix=(body.clip_label_prefix or ""),
    )
    if not created:
        raise HTTPException(status_code=500, detail="Could not generate clips")

    return GenerateClipsOut(
        character_id=character_id,
        mode="reviewed_lines",
        provider=provider_used,
        generated_count=len(created),
        clips=created,
    )


@router.post("/{character_id}/avatar-from-episode-thumb", response_model=CharacterOut)
def avatar_from_episode_thumbnail(character_id: str, body: AvatarFromEpisodeThumbBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    from services import episode_service

    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    eid = body.episode_id.strip()
    episode_service.ensure_uploaded_episode_in_memory(eid)
    ep = store.get_episode(eid)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    if ep.project_id != c.project_id:
        raise HTTPException(status_code=400, detail="Episode is not in this character's project")
    thumbs = [t for t in (ep.thumbnail_rels or []) if t]
    if body.thumb_index >= len(thumbs):
        raise HTTPException(status_code=400, detail="Thumbnail index out of range")
    rel = thumbs[body.thumb_index]
    src = (STORAGE_ROOT / rel).resolve()
    _r2_temp_thumb = False
    if not src.is_file() and r2_configured():
        from services.r2_storage import bucket_for_key
        src.parent.mkdir(parents=True, exist_ok=True)
        ok = r2_download(bucket_for_key(rel), rel, src)
        if not ok:
            raise HTTPException(status_code=404, detail="Thumbnail file missing")
        _r2_temp_thumb = True
    if not src.is_file():
        raise HTTPException(status_code=404, detail="Thumbnail file missing")
    ensure_storage_dirs()
    dest_dir = STORAGE_ROOT / "avatars" / character_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower() if src.suffix else ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        suffix = ".jpg"
    dest = dest_dir / f"avatar{suffix}"
    try:
        shutil.copy2(src, dest)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not copy image: {e}") from e
    if _r2_temp_thumb:
        try:
            src.unlink()
        except OSError:
            pass
    out_rel = to_rel_storage_path(dest)
    upload_local_and_clean(dest, out_rel)
    updated = character_service.update_character(character_id, thumbnail_paths=[out_rel])
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


class EnableSourceMatchedVoiceBody(BaseModel):
    rights_type: str = Field(..., min_length=1)
    proof_note: str = ""


@router.post("/{character_id}/enable-source-voice", response_model=CharacterOut)
def enable_source_matched_voice_endpoint(character_id: str, body: EnableSourceMatchedVoiceBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    log.info("POST /characters/%s/enable-source-voice rights_type=%s", character_id, body.rights_type)
    from services.source_voice_service import enable_source_matched_voice
    try:
        return enable_source_matched_voice(
            character_id,
            rights_type=body.rights_type.strip(),
            proof_note=(body.proof_note or "").strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        log.exception("enable-source-voice failed character_id=%s", character_id)
        raise HTTPException(
            status_code=500,
            detail="Could not set up source-matched voice right now. Please try again.",
        ) from e


@router.post("/{character_id}/clear-voice", response_model=CharacterOut)
def clear_attached_voice(character_id: str, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    updated = character_service.clear_character_voice(character_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


@router.delete("/{character_id}", status_code=204)
def remove_character(character_id: str):
    if not character_service.delete_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")


@router.patch("/{character_id}", response_model=CharacterOut)
def patch_character(character_id: str, body: PatchCharacterBody, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
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
def get_character(character_id: str, user_id: str = Depends(require_user_id)):
    check_ownership(store.character_owner_id(character_id), user_id)
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    return c
