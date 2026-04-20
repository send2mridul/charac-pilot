"""TTS preview generation — ElevenLabs if API key available, otherwise silent-WAV stub."""

from __future__ import annotations

import logging
import os
import struct
import uuid
import wave
from pathlib import Path

from storage_paths import STORAGE_ROOT

log = logging.getLogger("characpilot.tts")

PREVIEWS_DIR = STORAGE_ROOT / "previews"


def _ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def _elevenlabs_key() -> str | None:
    return os.environ.get("ELEVENLABS_API_KEY") or None


# Map built-in catalog voice_id values to ElevenLabs premade voice IDs.
# (Catalog labels are not valid ElevenLabs IDs by themselves.)
_CATALOG_TO_ELEVENLABS: dict[str, str] = {
    "warm_female": "EXAVITQu4vr4xnSDxMaL",  # Bella
    "young_male": "ErXwobaYiN019PkySvjV",  # Antoni
    "narrator_deep": "VR6AewLTigWG4xSOukaG",  # Arnold
    "cute_child": "MF3mGyEYCl7XYWbV9V6O",  # Elli
    "villain_dark": "AZnzlk1XvdvUeBnXmlld",  # Domi
}


def _resolve_elevenlabs_voice_id(voice_id: str | None) -> str:
    """Use catalog mapping or pass through a raw ElevenLabs voice id."""
    if not voice_id:
        return "21m00Tcm4TlvDq8ikWAM"  # Rachel
    if voice_id in _CATALOG_TO_ELEVENLABS:
        return _CATALOG_TO_ELEVENLABS[voice_id]
    return voice_id


def _generate_silent_wav(path: Path, duration_sec: float = 2.0) -> int:
    """Write a short silent WAV and return duration in ms."""
    sr = 22050
    n_samples = int(sr * duration_sec)
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(struct.pack(f"<{n_samples}h", *([0] * n_samples)))
    return int(duration_sec * 1000)


def _generate_elevenlabs(
    text: str,
    voice_id: str | None,
    style: str | None,
    out_path: Path,
) -> int:
    """Call ElevenLabs TTS API; returns duration_ms. Raises on failure."""
    import urllib.request
    import urllib.error
    import json as _json

    key = _elevenlabs_key()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")

    vid = _resolve_elevenlabs_voice_id(voice_id)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}"
    model_id = os.environ.get("ELEVENLABS_MODEL_ID") or "eleven_multilingual_v2"
    payload = _json.dumps({
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"ElevenLabs {e.code}: {body[:300]}") from e

    out_path.write_bytes(data)
    size_bytes = len(data)
    bitrate = 128_000
    duration_ms = max(500, int(size_bytes * 8 / bitrate * 1000))
    return duration_ms


def generate_preview(
    character_id: str,
    text: str,
    voice_id: str | None = None,
    style: str | None = None,
) -> dict:
    """Generate a TTS preview. Returns dict with preview_id, audio_url, duration_ms, provider."""
    preview_id = f"pv-{uuid.uuid4().hex[:10]}"
    char_dir = _ensure_dir(PREVIEWS_DIR / character_id)

    key = _elevenlabs_key()
    provider: str

    if key:
        ext = "mp3"
        out_path = char_dir / f"{preview_id}.{ext}"
        try:
            duration_ms = _generate_elevenlabs(text, voice_id, style, out_path)
            provider = "elevenlabs"
            log.info("elevenlabs preview ok id=%s dur=%dms", preview_id, duration_ms)
        except Exception as e:
            log.warning("elevenlabs failed, using stub: %s", e)
            ext = "wav"
            out_path = char_dir / f"{preview_id}.{ext}"
            duration_ms = _generate_silent_wav(out_path)
            provider = "stub"
    else:
        ext = "wav"
        out_path = char_dir / f"{preview_id}.{ext}"
        duration_ms = _generate_silent_wav(out_path)
        provider = "stub"
        log.info("stub preview (no ELEVENLABS_API_KEY) id=%s", preview_id)

    rel = out_path.resolve().relative_to(STORAGE_ROOT.resolve()).as_posix()
    audio_url = f"/media/{rel}"

    return {
        "preview_id": preview_id,
        "character_id": character_id,
        "audio_url": audio_url,
        "duration_ms": duration_ms,
        "text": text,
        "provider": provider,
    }


def synthesize_line_to_file(
    text: str,
    voice_id: str | None,
    style: str | None,
    out_base_no_ext: Path,
) -> tuple[int, str, bool, Path]:
    """Write TTS to disk. Returns (duration_ms, provider, fallback_used, final_path)."""
    key = _elevenlabs_key()
    out_base_no_ext.parent.mkdir(parents=True, exist_ok=True)

    if key:
        out_mp3 = out_base_no_ext.with_suffix(".mp3")
        try:
            duration_ms = _generate_elevenlabs(text, voice_id, style, out_mp3)
            log.info(
                "synthesize_line_to_file elevenlabs path=%s dur_ms=%s",
                out_mp3,
                duration_ms,
            )
            return duration_ms, "elevenlabs", False, out_mp3
        except Exception as e:
            log.warning("synthesize_line_to_file elevenlabs failed, stub: %s", e)
            out_wav = out_base_no_ext.with_suffix(".wav")
            duration_ms = _generate_silent_wav(out_wav)
            return duration_ms, "stub", True, out_wav

    out_wav = out_base_no_ext.with_suffix(".wav")
    duration_ms = _generate_silent_wav(out_wav)
    log.info("synthesize_line_to_file stub (no API key) path=%s", out_wav)
    return duration_ms, "stub", True, out_wav
