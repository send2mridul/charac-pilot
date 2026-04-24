"""User voice library: upload or record voice samples → ElevenLabs clone → reusable voice."""

from __future__ import annotations

import logging
import os
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from auth import check_ownership, require_user_id
from db.store import store
from schemas.user_voice import UserVoiceOut
from services.ffmpeg_bin import get_ffmpeg_paths
from services.r2_storage import upload_local_and_clean
from storage_paths import STORAGE_ROOT, to_rel_storage_path

router = APIRouter()
log = logging.getLogger("characpilot.user_voices")

_ALLOWED_AUDIO = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".wma", ".webm"}
_SAMPLES_DIR = STORAGE_ROOT / "user_voice_samples"


def _to_out(rec) -> UserVoiceOut:
    preview = None
    if rec.sample_audio_path:
        preview = f"/media/{rec.sample_audio_path}"
    elif rec.preview_audio_path:
        preview = f"/media/{rec.preview_audio_path}"
    return UserVoiceOut(
        id=rec.id,
        name=rec.name,
        elevenlabs_voice_id=rec.elevenlabs_voice_id,
        source_type=rec.source_type,
        rights_type=rec.rights_type,
        preview_url=preview,
        created_at=rec.created_at,
    )


def _normalize_to_wav(src: Path, dest: Path) -> None:
    ffmpeg_exe, _ = get_ffmpeg_paths()
    r = subprocess.run(
        [ffmpeg_exe, "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(src), "-acodec", "pcm_s16le", "-ar", "22050", "-ac", "1", str(dest)],
        capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(f"Audio normalization failed: {(r.stderr or '').strip()[:300]}")


def _clone_voice_elevenlabs(name: str, wav_path: Path) -> str | None:
    """Call ElevenLabs /v1/voices/add to create a voice from a single sample."""
    import urllib.request
    import urllib.error
    import json as _json

    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        log.warning("No ELEVENLABS_API_KEY; user voice saved locally but not cloned.")
        return None

    boundary = f"----CastWeave{uuid.uuid4().hex[:8]}"
    body_parts: list[bytes] = []

    def _field(name_: str, value: str) -> None:
        body_parts.append(f"--{boundary}\r\n".encode())
        body_parts.append(f'Content-Disposition: form-data; name="{name_}"\r\n\r\n'.encode())
        body_parts.append(f"{value}\r\n".encode())

    _field("name", name)
    _field("description", f"User voice: {name}")

    body_parts.append(f"--{boundary}\r\n".encode())
    body_parts.append(
        b'Content-Disposition: form-data; name="files"; filename="sample.wav"\r\n'
        b"Content-Type: audio/wav\r\n\r\n"
    )
    body_parts.append(wav_path.read_bytes())
    body_parts.append(b"\r\n")
    body_parts.append(f"--{boundary}--\r\n".encode())

    payload = b"".join(body_parts)
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/voices/add",
        data=payload,
        headers={
            "xi-api-key": key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = _json.loads(resp.read().decode())
        voice_id = data.get("voice_id")
        log.info("ElevenLabs voice created: %s for '%s'", voice_id, name)
        return voice_id
    except Exception as e:
        log.warning("ElevenLabs voice clone failed: %s", e)
        return None


async def _save_and_clone(
    file: UploadFile,
    name: str,
    rights_type: str,
    rights_note: str,
    source_type: str,
    user_id: str | None = None,
) -> UserVoiceOut:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in _ALLOWED_AUDIO:
        raise HTTPException(status_code=400, detail=f"Unsupported audio format: {suffix}")

    if rights_type not in ("my_voice", "have_permission"):
        raise HTTPException(status_code=400, detail="rights_type must be 'my_voice' or 'have_permission'")

    voice_id = f"uv-{uuid.uuid4().hex[:12]}"
    sample_dir = _SAMPLES_DIR / voice_id
    sample_dir.mkdir(parents=True, exist_ok=True)

    raw_path = sample_dir / f"raw{suffix}"
    try:
        content = await file.read()
        raw_path.write_bytes(content)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}") from e

    wav_path = sample_dir / "sample.wav"
    try:
        _normalize_to_wav(raw_path, wav_path)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    sample_rel = to_rel_storage_path(wav_path)
    el_voice_id = _clone_voice_elevenlabs(name.strip() or "My voice", wav_path)
    upload_local_and_clean(wav_path, sample_rel)
    raw_rel = to_rel_storage_path(raw_path)
    upload_local_and_clean(raw_path, raw_rel)

    rec = store.create_user_voice(
        voice_id=voice_id,
        name=name.strip() or "My voice",
        elevenlabs_voice_id=el_voice_id,
        source_type=source_type,
        sample_audio_path=sample_rel,
        rights_type=rights_type,
        rights_note=rights_note.strip(),
        user_id=user_id,
    )
    log.info("user voice created id=%s type=%s el_id=%s", voice_id, source_type, el_voice_id)
    return _to_out(rec)


@router.post("/upload", response_model=UserVoiceOut)
async def upload_user_voice(
    file: UploadFile = File(...),
    name: str = Form("My voice"),
    rights_type: str = Form(...),
    rights_note: str = Form(""),
    user_id: str = Depends(require_user_id),
):
    return await _save_and_clone(file, name, rights_type, rights_note, "uploaded", user_id=user_id)


@router.post("/from-recording", response_model=UserVoiceOut)
async def upload_recorded_voice(
    file: UploadFile = File(...),
    name: str = Form("My recorded voice"),
    rights_type: str = Form(...),
    rights_note: str = Form(""),
    user_id: str = Depends(require_user_id),
):
    return await _save_and_clone(file, name, rights_type, rights_note, "recorded", user_id=user_id)


@router.get("", response_model=list[UserVoiceOut])
def list_user_voices(user_id: str = Depends(require_user_id)):
    return [_to_out(r) for r in store.list_user_voices(user_id=user_id)]


@router.delete("/{voice_id}", status_code=204)
def delete_user_voice(voice_id: str, user_id: str = Depends(require_user_id)):
    check_ownership(store.user_voice_owner_id(voice_id), user_id)
    from services.r2_storage import bucket_for_key, delete_object, delete_prefix, r2_configured, artifacts_bucket
    rec = store.delete_user_voice(voice_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Voice not found")
    if rec.sample_audio_path:
        try:
            p = STORAGE_ROOT / rec.sample_audio_path
            if p.is_file():
                p.unlink()
        except OSError:
            pass
        if r2_configured():
            key = rec.sample_audio_path.replace("\\", "/")
            delete_object(bucket_for_key(key), key)
    if r2_configured():
        delete_prefix(artifacts_bucket(), f"user_voice_samples/{voice_id}/")
    log.info("user voice deleted id=%s", voice_id)
