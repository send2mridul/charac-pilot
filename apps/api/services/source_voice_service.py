"""Source-matched voice: extract speaker audio samples and clone via ElevenLabs IVC."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from db.records import CharacterRecord, TranscriptSegmentRecord
from db.store import store
from storage_paths import STORAGE_ROOT

log = logging.getLogger("characpilot.source_voice")

SPEAKER_SAMPLES_DIR = STORAGE_ROOT / "speaker_samples"


def _elevenlabs_key() -> str | None:
    return os.environ.get("ELEVENLABS_API_KEY") or None


def extract_speaker_audio_samples(
    episode_id: str,
    speaker_label: str,
    *,
    max_samples: int = 5,
    min_duration: float = 1.5,
    max_total_sec: float = 60.0,
) -> list[Path]:
    """Extract short WAV clips for a speaker from the episode audio using FFmpeg."""
    ep = store.get_episode(episode_id)
    if not ep or not ep.extracted_audio_rel:
        log.warning("extract_speaker_audio_samples: no episode audio for %s", episode_id)
        return []

    audio_path = STORAGE_ROOT / ep.extracted_audio_rel
    if not audio_path.is_file():
        log.warning("extract_speaker_audio_samples: audio file missing %s", audio_path)
        return []

    segments = store.list_transcript_segments(episode_id)
    speaker_segs = [
        s for s in segments
        if s.speaker_label == speaker_label and (s.end_time - s.start_time) >= min_duration
    ]
    speaker_segs.sort(key=lambda s: s.end_time - s.start_time, reverse=True)

    out_dir = SPEAKER_SAMPLES_DIR / episode_id / speaker_label.replace("/", "_")
    out_dir.mkdir(parents=True, exist_ok=True)

    extracted: list[Path] = []
    total_sec = 0.0

    for seg in speaker_segs[:max_samples * 2]:
        if len(extracted) >= max_samples:
            break
        dur = seg.end_time - seg.start_time
        if total_sec + dur > max_total_sec:
            continue
        clip_id = uuid.uuid4().hex[:8]
        out_path = out_dir / f"sample_{clip_id}.wav"
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", str(audio_path),
                    "-ss", f"{seg.start_time:.3f}",
                    "-to", f"{seg.end_time:.3f}",
                    "-ac", "1",
                    "-ar", "22050",
                    str(out_path),
                ],
                capture_output=True,
                timeout=30,
                check=True,
            )
            if out_path.is_file() and out_path.stat().st_size > 1000:
                extracted.append(out_path)
                total_sec += dur
        except Exception as e:
            log.warning("ffmpeg sample extract failed: %s", e)

    return extracted


def clone_speaker_voice(
    character: CharacterRecord,
    sample_paths: list[Path],
    voice_name: str | None = None,
) -> str:
    """Upload speaker samples to ElevenLabs Instant Voice Clone. Returns new voice_id."""
    key = _elevenlabs_key()
    if not key:
        raise RuntimeError("Voice cloning requires an API key to be configured")

    if not sample_paths:
        raise ValueError("At least one audio sample is required")

    name = (voice_name or character.name or "Speaker").strip()[:64]
    boundary = uuid.uuid4().hex
    content_type = f"multipart/form-data; boundary={boundary}"

    body_parts: list[bytes] = []
    body_parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n{name}\r\n".encode()
    )
    body_parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"description\"\r\n\r\n"
        f"Source-matched voice for {name}\r\n".encode()
    )

    for sp in sample_paths[:25]:
        if not sp.is_file():
            continue
        data = sp.read_bytes()
        fname = sp.name
        body_parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{fname}\"\r\n"
            f"Content-Type: audio/wav\r\n\r\n".encode()
            + data
            + b"\r\n"
        )

    body_parts.append(f"--{boundary}--\r\n".encode())
    payload = b"".join(body_parts)

    url = "https://api.elevenlabs.io/v1/voices/add"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "xi-api-key": key,
            "Content-Type": content_type,
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        raise RuntimeError(f"Voice cloning failed ({e.code}): {body_text[:300]}") from e

    voice_id = result.get("voice_id")
    if not voice_id:
        raise RuntimeError("Voice cloning returned no voice_id")

    log.info("clone_speaker_voice ok character=%s voice_id=%s", character.id, voice_id)
    return str(voice_id)


def enable_source_matched_voice(
    character_id: str,
    rights_type: str,
    proof_note: str = "",
) -> CharacterRecord:
    """Gate: confirm rights and extract + clone the speaker's voice."""
    from services import character_service

    char = character_service.get_character(character_id)
    if not char:
        raise ValueError("Character not found")

    if not char.source_episode_id or not char.source_speaker_labels:
        raise ValueError("Character has no source episode or speaker label for voice matching")

    episode_id = char.source_episode_id
    speaker_label = char.source_speaker_labels[0]

    samples = extract_speaker_audio_samples(episode_id, speaker_label)
    if not samples:
        raise ValueError("Could not extract enough audio samples for this speaker")

    voice_id = clone_speaker_voice(char, samples, voice_name=char.name)

    updated = character_service.update_character(
        character_id,
        source_matched_voice_enabled=True,
        source_matched_rights_confirmed=True,
        source_matched_rights_type=rights_type,
        source_matched_proof_note=proof_note,
        source_matched_voice_id=voice_id,
        default_voice_id=voice_id,
        voice_provider="primary",
        voice_display_name=f"{char.name} (source-matched)",
        voice_source_type="source_matched",
    )
    if not updated:
        raise ValueError("Failed to update character with source-matched voice")

    return updated
