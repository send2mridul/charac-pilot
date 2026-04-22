"""Local speech-to-text using faster-whisper (downloads model on first use)."""

from __future__ import annotations

import logging
import os
import re
import uuid
import wave
from pathlib import Path
from typing import Any

from db.store import TranscriptSegmentRecord

logger = logging.getLogger(__name__)

_model_cache: dict[tuple[str, str, str], Any] = {}

_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")

_COVERAGE_LOW_THRESHOLD = 0.40

_HINDI_INITIAL_PROMPT = "हिंदी में बोला गया वीडियो।"

_HINDI_ADJACENT_LANGS = frozenset({"ur", "mr", "pa", "bn", "ne", "gu", "sd"})

# Roman Hindi / Hinglish cues in Latin script (when Whisper reports "en" but audio is Hindi).
_ROMAN_HINDI_HINT_RE = re.compile(
    r"\b(?:"
    r"hai|hain|nahin|nahi|nahii|kyaa|kya|mera|meri|mere|aapko|aap|humko|hum|"
    r"yeh|ye|unka|uska|usko|mujhe|raha|rahi|rahe|tha|thi|the|andar|lekin|"
    r"bas|abhi|phir|fir|kaise|kyun|kabhi|kab|kahan|kahaan|dekho|suno|bolo|"
    r"accha|acha|theek|thik|zaroor|bahut|kitna|kitni|kitne|waqt|dosto|"
    r"namaste|dhanyavaad|shukriya|kripya"
    r")\b",
    re.IGNORECASE,
)


def _roman_hindi_hint_score(text: str) -> tuple[float, int]:
    """Returns (hint_hits / word_count, raw_hit_count) using Latin word tokens."""
    raw = (text or "").strip()
    if not raw:
        return 0.0, 0
    lower = raw.lower()
    hits = len(_ROMAN_HINDI_HINT_RE.findall(lower))
    if hits == 0:
        return 0.0, 0
    words = re.findall(r"[A-Za-z]+", raw)
    nwords = max(1, len(words))
    return hits / float(nwords), hits


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _model_size_for_language(language: str | None) -> str:
    """Per-language model tier. Hindi uses a larger model by default."""
    base_default = _env("WHISPER_MODEL_SIZE", "base").lower()
    if language == "hi":
        return _env("WHISPER_MODEL_SIZE_HI", "small").lower()
    return _env("WHISPER_MODEL_SIZE_EN", base_default).lower()


def _get_whisper_model(model_size: str):
    """Reuse a WhisperModel per (size, device, compute)."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise RuntimeError(
            "faster-whisper is not installed. From apps/api run: "
            "python -m pip install -r requirements.txt "
            "(use the same python that runs uvicorn)"
        ) from e

    device = _env("WHISPER_DEVICE", "cpu").lower()
    compute_type = _env("WHISPER_COMPUTE_TYPE", "")
    if not compute_type:
        compute_type = "int8" if device == "cpu" else "float16"

    key = (model_size, device, compute_type)
    cached = _model_cache.get(key)
    if cached is not None:
        return cached

    logger.info(
        "Loading Whisper model=%s device=%s compute_type=%s (first use may download weights)",
        model_size,
        device,
        compute_type,
    )
    try:
        m = WhisperModel(model_size, device=device, compute_type=compute_type)
    except Exception as e:
        raise RuntimeError(
            f"Could not load Whisper model '{model_size}'. "
            "Check disk space and network (first run downloads weights). "
            f"Original error: {e}"
        ) from e
    _model_cache[key] = m
    return m


def _wav_duration_sec(path: Path) -> float:
    """Best-effort WAV duration; returns 0 on failure."""
    try:
        with wave.open(str(path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate() or 1
            return frames / float(rate)
    except Exception:
        return 0.0


def _sum_segment_duration(records: list[TranscriptSegmentRecord]) -> float:
    total = 0.0
    for r in records:
        d = float(r.end_time) - float(r.start_time)
        if d > 0:
            total += d
    return total


def _coverage_ratio(records: list[TranscriptSegmentRecord], wav_duration: float) -> float:
    if wav_duration <= 0:
        return 1.0
    return min(1.0, _sum_segment_duration(records) / wav_duration)


def _records_from_segments(segments_iter: Any, episode_id: str) -> list[TranscriptSegmentRecord]:
    out: list[TranscriptSegmentRecord] = []
    for seg in segments_iter:
        text = (getattr(seg, "text", "") or "").strip()
        if not text:
            continue
        out.append(
            TranscriptSegmentRecord(
                segment_id=f"ts-{uuid.uuid4().hex[:10]}",
                episode_id=episode_id,
                start_time=float(seg.start),
                end_time=float(seg.end),
                text=text,
                speaker_label=None,
            ),
        )
    return out


def _transcribe_hindi(
    model: Any,
    wav_path: Path,
    episode_id: str,
    *,
    tuned_vad: bool,
) -> tuple[list[TranscriptSegmentRecord], str]:
    """Run a Hindi-forced transcription pass with tuned parameters."""
    kwargs: dict[str, Any] = {
        "beam_size": 5,
        "task": "transcribe",
        "language": "hi",
        "initial_prompt": _HINDI_INITIAL_PROMPT,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.2,
        "compression_ratio_threshold": 3.0,
    }
    if tuned_vad:
        kwargs["vad_filter"] = True
        kwargs["vad_parameters"] = {
            "min_silence_duration_ms": 200,
            "threshold": 0.2,
            "speech_pad_ms": 400,
        }
    else:
        kwargs["vad_filter"] = False

    segments_gen, info = model.transcribe(str(wav_path), **kwargs)
    records = _records_from_segments(segments_gen, episode_id)
    lang = getattr(info, "language", None) or "hi"
    return records, lang


def transcribe_wav_to_records(
    wav_path: Path,
    episode_id: str,
) -> tuple[str | None, list[TranscriptSegmentRecord], dict[str, Any]]:
    """
    Run Whisper on a WAV file. Returns (detected_language, segments, diagnostics).

    diagnostics dict keys:
      model_en, model_hi: model sizes used
      detected_language, detected_probability
      devanagari_probe: bool, did the detect-pass text contain Devanagari
      forced_hindi: bool, env override used
      coverage_ratio: float (0..1)
      low_coverage: bool
      retry_triggered: bool
      final_segments: int
      path: "local_whisper"

    Env:
      WHISPER_MODEL_SIZE         - legacy default (base)
      WHISPER_MODEL_SIZE_EN      - English tier (default: base)
      WHISPER_MODEL_SIZE_HI      - Hindi tier (default: small)
      WHISPER_DEVICE             - cpu | cuda (default: cpu)
      WHISPER_COMPUTE_TYPE       - int8 | float16 (default: int8 on cpu)
      CASTWEAVE_FORCE_HINDI      - 1/true to skip detect and force Hindi
      CASTWEAVE_ASR_DIAG         - set on API process: log raw vs final transcript lines (see episode_media_worker)
    """
    if not wav_path.is_file():
        raise RuntimeError(f"WAV not found: {wav_path}")

    wav_duration = _wav_duration_sec(wav_path)
    force_hindi = _env("CASTWEAVE_FORCE_HINDI", "").lower() in ("1", "true", "yes")

    diag: dict[str, Any] = {
        "path": "local_whisper",
        "model_en": _model_size_for_language("en"),
        "model_hi": _model_size_for_language("hi"),
        "detected_language": None,
        "detected_probability": 0.0,
        "devanagari_probe": False,
        "forced_hindi": force_hindi,
        "coverage_ratio": 1.0,
        "low_coverage": False,
        "retry_triggered": False,
        "final_segments": 0,
        "wav_duration_sec": round(wav_duration, 2),
        "language_override": None,
    }

    # ---- Decide language ----
    language: str | None
    detect_records: list[TranscriptSegmentRecord] = []

    if force_hindi:
        logger.info(
            "castweave_hindi step=force_env episode_id=%s",
            episode_id,
        )
        diag["language_override"] = "CASTWEAVE_FORCE_HINDI"
        language = "hi"
    else:
        detect_model_size = _model_size_for_language(None)  # base by default
        detect_model = _get_whisper_model(detect_model_size)
        detect_gen, detect_info = detect_model.transcribe(
            str(wav_path),
            beam_size=5,
            vad_filter=True,
            task="transcribe",
        )
        language = getattr(detect_info, "language", None)
        lang_prob = float(getattr(detect_info, "language_probability", 0) or 0)
        diag["detected_language"] = language
        diag["detected_probability"] = round(lang_prob, 3)

        # Devanagari probe over detect-pass output.
        detect_records = _records_from_segments(detect_gen, episode_id)
        early_text = " ".join(r.text for r in detect_records[:20])
        devanagari_hit = bool(_DEVANAGARI_RE.search(early_text))
        diag["devanagari_probe"] = devanagari_hit

        logger.info(
            "castweave_hindi step=detect episode_id=%s detected=%s prob=%.3f devanagari=%s model=%s",
            episode_id,
            language,
            lang_prob,
            devanagari_hit,
            detect_model_size,
        )

        if devanagari_hit and language != "hi":
            logger.info(
                "castweave_hindi step=devanagari_override episode_id=%s from=%s to=hi",
                episode_id,
                language,
            )
            diag["language_override"] = "devanagari_probe"
            language = "hi"
        elif language in _HINDI_ADJACENT_LANGS and lang_prob < 0.7:
            logger.info(
                "castweave_hindi step=adjacent_lang_override episode_id=%s from=%s prob=%.3f to=hi",
                episode_id,
                language,
                lang_prob,
            )
            diag["language_override"] = "adjacent_lang_low_conf"
            language = "hi"
        elif language == "en" and wav_duration >= 1.5:
            # Whisper often labels Roman-Hindi / Hinglish as "en". Promote only when
            # detect-pass text shows strong Roman Hindi cues — avoids the old blanket
            # low-confidence English→Hindi rule that broke short English clips.
            rh_score, rh_hits = _roman_hindi_hint_score(early_text)
            diag["roman_hindi_hint_score"] = round(rh_score, 4)
            diag["roman_hindi_hint_hits"] = rh_hits
            uncertain = lang_prob < 0.82
            strong = rh_hits >= 3 and rh_score >= 0.04
            moderate = rh_hits >= 2 and rh_score >= 0.07 and wav_duration >= 4.0
            if uncertain and (strong or moderate):
                logger.info(
                    "castweave_hindi step=roman_hindi_probe episode_id=%s "
                    "detected=en prob=%.3f hits=%d score=%.4f duration=%.1f to=hi",
                    episode_id,
                    lang_prob,
                    rh_hits,
                    rh_score,
                    wav_duration,
                )
                diag["language_override"] = "roman_hindi_probe"
                language = "hi"

    # ---- Main pass ----
    if language == "hi":
        hi_model_size = _model_size_for_language("hi")
        logger.info(
            "castweave_hindi step=hindi_pass episode_id=%s model=%s vad=tuned",
            episode_id,
            hi_model_size,
        )
        hi_model = _get_whisper_model(hi_model_size)
        records, language = _transcribe_hindi(
            hi_model, wav_path, episode_id, tuned_vad=True,
        )

        cov = _coverage_ratio(records, wav_duration)
        diag["coverage_ratio"] = round(cov, 3)
        logger.info(
            "castweave_hindi step=hindi_pass_done episode_id=%s segments=%d coverage=%.3f duration=%.1f",
            episode_id,
            len(records),
            cov,
            wav_duration,
        )

        if cov < _COVERAGE_LOW_THRESHOLD and wav_duration > 5.0:
            diag["retry_triggered"] = True
            logger.warning(
                "castweave_hindi step=coverage_low episode_id=%s coverage=%.3f threshold=%.2f; retrying with vad_filter=False",
                episode_id,
                cov,
                _COVERAGE_LOW_THRESHOLD,
            )
            retry_records, retry_lang = _transcribe_hindi(
                hi_model, wav_path, episode_id, tuned_vad=False,
            )
            retry_cov = _coverage_ratio(retry_records, wav_duration)
            logger.info(
                "castweave_hindi step=hindi_retry_done episode_id=%s segments=%d coverage=%.3f (was %.3f)",
                episode_id,
                len(retry_records),
                retry_cov,
                cov,
            )
            if retry_cov > cov or len(retry_records) > len(records):
                records = retry_records
                language = retry_lang
                diag["coverage_ratio"] = round(retry_cov, 3)
                cov = retry_cov

        if cov < _COVERAGE_LOW_THRESHOLD and wav_duration > 5.0:
            diag["low_coverage"] = True
            logger.warning(
                "castweave_hindi step=still_low_coverage episode_id=%s coverage=%.3f segments=%d",
                episode_id,
                cov,
                len(records),
            )
    else:
        # Non-Hindi: reuse detect-pass output, no second run.
        records = detect_records
        if not force_hindi:
            cov = _coverage_ratio(records, wav_duration)
            diag["coverage_ratio"] = round(cov, 3)
            if cov < _COVERAGE_LOW_THRESHOLD and wav_duration > 10.0:
                diag["low_coverage"] = True
                logger.warning(
                    "castweave_hindi step=en_low_coverage episode_id=%s language=%s coverage=%.3f",
                    episode_id,
                    language,
                    cov,
                )

    diag["final_segments"] = len(records)
    logger.info(
        "castweave_hindi step=done episode_id=%s language=%s segments=%d coverage=%.3f low=%s retry=%s forced=%s",
        episode_id,
        language,
        len(records),
        diag["coverage_ratio"],
        diag["low_coverage"],
        diag["retry_triggered"],
        diag["forced_hindi"],
    )
    return language, records, diag
