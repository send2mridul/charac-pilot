"""Fetch ElevenLabs voices with local fallback; short-lived in-memory cache."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any, Literal

from services.tts_service import _elevenlabs_key

log = logging.getLogger("characpilot.voice_catalog")

ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v1/voices"

# Cache full mapped list to avoid hammering the API (TTL seconds).
_CACHE_TTL_SEC = 120.0
_cache: tuple[list[dict[str, Any]], Literal["elevenlabs", "local_fallback"], float] | None = None

LOCAL_VOICES: list[dict[str, Any]] = [
    {
        "voice_id": "warm_female",
        "display_name": "Warm Female",
        "description": "Smooth and warm alto voice with natural cadence.",
        "category": "local",
        "tags": ["female", "warm", "narration"],
        "suggested_use": "Female leads, narrators, gentle characters",
    },
    {
        "voice_id": "young_male",
        "display_name": "Young Male",
        "description": "Energetic young male tenor, slightly casual.",
        "category": "local",
        "tags": ["male", "young", "dialogue"],
        "suggested_use": "Male leads, supporting cast, dialogue-heavy roles",
    },
    {
        "voice_id": "narrator_deep",
        "display_name": "Narrator Deep",
        "description": "Deep, authoritative baritone with measured pacing.",
        "category": "local",
        "tags": ["narrator", "deep", "documentary"],
        "suggested_use": "Narrators, intros, voiceover, documentary",
    },
    {
        "voice_id": "cute_child",
        "display_name": "Cute Child",
        "description": "Light, bright child voice with playful energy.",
        "category": "local",
        "tags": ["child", "playful"],
        "suggested_use": "Child characters, playful sidekicks",
    },
    {
        "voice_id": "villain_dark",
        "display_name": "Villain Dark",
        "description": "Low, menacing voice with slow deliberate pacing.",
        "category": "local",
        "tags": ["villain", "dark", "antagonist"],
        "suggested_use": "Antagonists, mysterious figures, dark narration",
    },
]


def _map_elevenlabs_voice(v: dict[str, Any]) -> dict[str, Any]:
    labels = v.get("labels") or {}
    tags: list[str] = []
    if isinstance(labels, dict):
        for key, val in labels.items():
            if val is None or val == "":
                continue
            tags.append(f"{key}:{val}")
    category = v.get("category")
    if category and str(category) not in tags:
        tags.insert(0, f"category:{category}")
    name = v.get("name") or v.get("voice_id") or "Unknown"
    desc = (v.get("description") or "").strip()
    use_case = labels.get("use_case") if isinstance(labels, dict) else None
    suggested = use_case or (desc[:120] + "…" if len(desc) > 120 else desc) or "ElevenLabs voice"
    return {
        "voice_id": v["voice_id"],
        "display_name": name,
        "description": desc,
        "category": str(category) if category is not None else None,
        "tags": tags,
        "suggested_use": suggested,
    }


def _fetch_elevenlabs_raw() -> list[dict[str, Any]]:
    key = _elevenlabs_key()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")

    req = urllib.request.Request(
        ELEVENLABS_VOICES_URL,
        headers={
            "xi-api-key": key,
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"ElevenLabs voices {e.code}: {body[:400]}") from e

    voices = data.get("voices") or []
    if not isinstance(voices, list):
        return []
    return [_map_elevenlabs_voice(v) for v in voices if isinstance(v, dict) and v.get("voice_id")]


def get_voice_pool() -> tuple[list[dict[str, Any]], Literal["elevenlabs", "local_fallback"], str | None]:
    """Return (voices, source, fallback_message). Uses cache when ElevenLabs succeeds."""
    global _cache
    now = time.monotonic()

    if _cache is not None:
        voices, source, ts = _cache
        if now - ts < _CACHE_TTL_SEC:
            return voices, source, None if source == "elevenlabs" else "Using built-in catalog (cached)."

    key = _elevenlabs_key()
    if not key:
        log.info("voice catalog: no ELEVENLABS_API_KEY, using local fallback")
        _cache = (LOCAL_VOICES.copy(), "local_fallback", now)
        return _cache[0], "local_fallback", "No API key — showing built-in voices only."

    try:
        mapped = _fetch_elevenlabs_raw()
        if not mapped:
            log.warning("voice catalog: ElevenLabs returned no voices, using local fallback")
            _cache = (LOCAL_VOICES.copy(), "local_fallback", now)
            return _cache[0], "local_fallback", "ElevenLabs returned no voices — using built-in catalog."
        mapped.sort(key=lambda x: (x.get("display_name") or "").lower())
        _cache = (mapped, "elevenlabs", now)
        log.info("voice catalog: loaded %d voices from ElevenLabs", len(mapped))
        return mapped, "elevenlabs", None
    except Exception as e:
        log.warning("voice catalog: ElevenLabs fetch failed: %s", e)
        _cache = (LOCAL_VOICES.copy(), "local_fallback", now)
        err = str(e)
        hint = ""
        if "voices_read" in err or "missing_permissions" in err:
            hint = (
                " Your ElevenLabs API key needs the voices_read permission "
                "(key settings) to list voices."
            )
        return (
            _cache[0],
            "local_fallback",
            f"ElevenLabs unavailable ({err[:180]}) — using built-in catalog.{hint}",
        )


def paginate_voices(
    voices: list[dict[str, Any]],
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    total = len(voices)
    start = (page - 1) * page_size
    end = start + page_size
    return voices[start:end], total


def search_voices(
    voices: list[dict[str, Any]],
    q: str,
) -> list[dict[str, Any]]:
    q = (q or "").strip().lower()
    if not q:
        return list(voices)

    out: list[dict[str, Any]] = []
    for v in voices:
        name = (v.get("display_name") or "").lower()
        desc = (v.get("description") or "").lower()
        vid = (v.get("voice_id") or "").lower()
        tags = v.get("tags") or []
        tag_blob = " ".join(str(t).lower() for t in tags)
        cat = (v.get("category") or "").lower()
        sug = (v.get("suggested_use") or "").lower()
        if (
            q in name
            or q in desc
            or q in vid
            or q in tag_blob
            or q in cat
            or q in sug
            or any(q in str(t).lower() for t in tags)
        ):
            out.append(v)
    return out
