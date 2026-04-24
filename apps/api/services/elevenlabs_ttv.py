"""ElevenLabs Text-to-Voice: design, remix, and create voice from preview."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from services.r2_storage import upload_local_and_clean
from storage_paths import STORAGE_ROOT, to_rel_storage_path

log = logging.getLogger("characpilot.elevenlabs_ttv")

BASE = "https://api.elevenlabs.io"
DESIGN_URL = f"{BASE}/v1/text-to-voice/design"
CREATE_VOICE_URL = f"{BASE}/v1/text-to-voice"


def _api_key() -> str | None:
    return os.environ.get("ELEVENLABS_API_KEY") or None


def _pad_voice_description(s: str) -> str:
    s = s.strip()
    if len(s) < 20:
        s = (s + ". Voice design prompt.")[:1000]
    return s[:1000]


def _pad_preview_text(s: str) -> str:
    s = s.strip()
    if len(s) < 100:
        s = (
            s
            + " This sample line is used to preview the generated voice and must be long enough for the provider."
        )
    return s[:1000]


def _post_json(url: str, payload: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    key = _api_key()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"ElevenLabs {e.code}: {body[:500]}") from e


def design_previews(
    voice_description: str,
    preview_text: str | None,
    model_id: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Returns (preview_text_used, list of raw preview dicts from API)."""
    text_used = _pad_preview_text(preview_text or "")
    payload: dict[str, Any] = {
        "voice_description": _pad_voice_description(voice_description),
        "model_id": model_id or "eleven_multilingual_ttv_v2",
        "auto_generate_text": not bool(preview_text and preview_text.strip()),
    }
    if not payload["auto_generate_text"]:
        payload["text"] = text_used
    raw = _post_json(DESIGN_URL, payload)
    previews = raw.get("previews") or []
    text_out = raw.get("text") or text_used
    return text_out, previews


def remix_previews(
    voice_id: str,
    remix_prompt: str,
    preview_text: str | None,
) -> tuple[str, list[dict[str, Any]]]:
    vid = urllib.parse.quote(voice_id, safe="")
    url = f"{BASE}/v1/text-to-voice/{vid}/remix"
    text_used = _pad_preview_text(preview_text or "")
    payload: dict[str, Any] = {
        "voice_description": _pad_voice_description(remix_prompt),
        "auto_generate_text": not bool(preview_text and preview_text.strip()),
    }
    if not payload["auto_generate_text"]:
        payload["text"] = text_used
    raw = _post_json(url, payload)
    previews = raw.get("previews") or []
    text_out = raw.get("text") or text_used
    return text_out, previews


def create_voice_from_generated(
    voice_name: str,
    voice_description: str,
    generated_voice_id: str,
) -> dict[str, Any]:
    payload = {
        "voice_name": voice_name,
        "voice_description": voice_description[:1000],
        "generated_voice_id": generated_voice_id,
    }
    return _post_json(CREATE_VOICE_URL, payload, timeout=90)


def _user_hash(user_id: str) -> str:
    return hashlib.sha256(user_id.encode()).hexdigest()[:16]


def write_preview_files(
    previews: list[dict[str, Any]],
    subdir: str,
    *,
    user_id: str,
) -> list[dict[str, Any]]:
    """Decode base64 previews to storage; return candidate dicts with URLs."""
    batch = uuid.uuid4().hex[:12]
    base = STORAGE_ROOT / "voice_design" / _user_hash(user_id) / subdir / batch
    base.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    for i, p in enumerate(previews[:6]):
        b64 = p.get("audio_base_64") or p.get("audio_base64")
        gid = p.get("generated_voice_id") or ""
        if not b64 or not gid:
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        path = base / f"{i}.mp3"
        path.write_bytes(raw)
        rel = to_rel_storage_path(path)
        upload_local_and_clean(path, rel)
        out.append(
            {
                "generated_voice_id": gid,
                "label": f"Option {len(out) + 1}",
                "preview_audio_url": f"/media/{rel}",
                "duration_secs": p.get("duration_secs"),
                "media_type": p.get("media_type"),
            },
        )
        if len(out) >= 3:
            break
    return out
