"""Local speech-to-text using faster-whisper (downloads model on first use)."""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Any

from db.store import TranscriptSegmentRecord

logger = logging.getLogger(__name__)

_model_cache: Any = None
_model_cache_key: tuple[str, str, str] | None = None


def _get_whisper_model():
    """Reuse one WhisperModel per process (same size/device/compute)."""
    global _model_cache, _model_cache_key

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise RuntimeError(
            "faster-whisper is not installed. From apps/api run: pip install -r requirements.txt"
        ) from e

    model_size = os.environ.get("WHISPER_MODEL_SIZE", "tiny").strip().lower()
    device = os.environ.get("WHISPER_DEVICE", "cpu").strip().lower()
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "").strip()
    if not compute_type:
        compute_type = "int8" if device == "cpu" else "float16"

    key = (model_size, device, compute_type)
    if _model_cache is not None and _model_cache_key == key:
        return _model_cache

    logger.info(
        "Loading Whisper model=%s device=%s compute_type=%s (may download on first run)",
        model_size,
        device,
        compute_type,
    )
    try:
        _model_cache = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
        )
        _model_cache_key = key
    except Exception as e:
        raise RuntimeError(
            f"Could not load Whisper model '{model_size}'. "
            "Check disk space and network (first run downloads weights). "
            f"Original error: {e}"
        ) from e
    return _model_cache


def transcribe_wav_to_records(
    wav_path: Path,
    episode_id: str,
) -> tuple[str | None, list[TranscriptSegmentRecord]]:
    """
    Run Whisper on a WAV file. Returns (detected_language, segments).

    Env:
      WHISPER_MODEL_SIZE — tiny | base | small | medium (default: tiny)
      WHISPER_DEVICE — cpu | cuda (default: cpu)
      WHISPER_COMPUTE_TYPE — int8 | float16 | default (default: int8 on cpu)
    """
    if not wav_path.is_file():
        raise RuntimeError(f"WAV not found: {wav_path}")

    model = _get_whisper_model()

    segments_gen, info = model.transcribe(
        str(wav_path),
        beam_size=5,
        vad_filter=True,
    )
    language = getattr(info, "language", None)

    records: list[TranscriptSegmentRecord] = []
    for seg in segments_gen:
        text = (seg.text or "").strip()
        if not text:
            continue
        records.append(
            TranscriptSegmentRecord(
                segment_id=f"ts-{uuid.uuid4().hex[:10]}",
                episode_id=episode_id,
                start_time=float(seg.start),
                end_time=float(seg.end),
                text=text,
                speaker_label=None,
            ),
        )

    logger.info(
        "Whisper done episode_id=%s language=%s segments=%s",
        episode_id,
        language,
        len(records),
    )
    return language, records
