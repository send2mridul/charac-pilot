"""Voice design / remix orchestration and save-to-character."""

from __future__ import annotations

import logging
import os
import re

from schemas.voice_design import (
    DesignVoiceBody,
    DesignVoiceResponse,
    RemixVoiceBody,
    RemixVoiceResponse,
    SaveCustomVoiceBody,
    SaveCustomVoiceResult,
    VoicePreviewCandidateOut,
)
from services import character_service
from services.elevenlabs_ttv import (
    create_voice_from_generated,
    design_previews,
    remix_previews,
    write_preview_files,
)

log = logging.getLogger("characpilot.voice_design")

_SAFE_EXAMPLE_PROMPTS = [
    "Warm youthful narrator with bright tone, gentle pacing, and clear articulation.",
    "Light-pitched expressive storytelling voice, playful energy, and friendly delivery.",
    "Animated storybook-style voice with soft warmth and energetic rhythm.",
    "Bright and gentle voice with expressive phrasing, suitable for family content.",
    "Playful youthful tone with clear diction, upbeat pacing, and cheerful mood.",
]

_NORMALIZE_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\blittle\s+girl\b", re.I), "youthful bright expressive voice"),
    (re.compile(r"\blittle\s+boy\b", re.I), "youthful energetic expressive voice"),
    (re.compile(r"\btoddler\b", re.I), "playful light-pitched animated voice"),
    (re.compile(r"\bbaby\b", re.I), "gentle light-pitched youthful voice"),
    (re.compile(r"\bminor\b", re.I), "youthful storybook-style voice"),
    (re.compile(r"\bchild\b", re.I), "youthful bright storybook-style voice"),
    (re.compile(r"\bkid\b", re.I), "youthful playful expressive voice"),
]


def _is_safety_block_error(msg: str) -> bool:
    m = msg.lower()
    return (
        "blocked_generation" in m
        or "safety" in m
        or "policy" in m
        or "blocked" in m
    )


def _normalize_design_prompt(prompt: str) -> str:
    out = prompt
    for pattern, replacement in _NORMALIZE_RULES:
        out = pattern.sub(replacement, out)
    out = " ".join(out.split())
    return out[:1000]


def design_voice(body: DesignVoiceBody) -> DesignVoiceResponse:
    if not os.environ.get("ELEVENLABS_API_KEY"):
        return DesignVoiceResponse(
            source="fallback",
            message="ELEVENLABS_API_KEY is not set. Voice Design requires a configured ElevenLabs API key.",
            preview_text_used="",
            candidates=[],
        )
    original_prompt = body.voice_description.strip()
    normalized_retry_used = False
    rewritten_prompt: str | None = None
    try:
        text_used, raw = design_previews(
            original_prompt,
            body.preview_text,
            body.model_id,
        )
    except Exception as e:
        msg = str(e)
        if not _is_safety_block_error(msg):
            log.warning("voice design failed: %s", e)
            return DesignVoiceResponse(
                source="fallback",
                message=str(e)[:400],
                preview_text_used="",
                candidates=[],
                safe_example_prompts=_SAFE_EXAMPLE_PROMPTS,
            )

        rewritten_prompt = _normalize_design_prompt(original_prompt)
        if rewritten_prompt and rewritten_prompt.lower() != original_prompt.lower():
            try:
                text_used, raw = design_previews(
                    rewritten_prompt,
                    body.preview_text,
                    body.model_id,
                )
                normalized_retry_used = True
            except Exception as retry_err:
                log.warning("voice design retry failed: %s", retry_err)
                return DesignVoiceResponse(
                    source="fallback",
                    message=(
                        "Provider blocked this request after automatic prompt adjustment. "
                        "Try describing the sound and style rather than age labels."
                    ),
                    preview_text_used="",
                    candidates=[],
                    normalized_retry_used=True,
                    original_prompt=original_prompt,
                    rewritten_prompt=rewritten_prompt,
                    safe_example_prompts=_SAFE_EXAMPLE_PROMPTS,
                )
        else:
            log.warning("voice design blocked and no safe rewrite applied: %s", e)
            return DesignVoiceResponse(
                source="fallback",
                message=(
                    "Provider blocked this request. Try describing the sound and style "
                    "rather than age labels."
                ),
                preview_text_used="",
                candidates=[],
                safe_example_prompts=_SAFE_EXAMPLE_PROMPTS,
            )

    try:
        files = write_preview_files(raw, "design")
        cands = [
            VoicePreviewCandidateOut(
                generated_voice_id=x["generated_voice_id"],
                label=x["label"],
                preview_audio_url=x["preview_audio_url"],
                duration_secs=x.get("duration_secs"),
            )
            for x in files[:3]
        ]
        log.info("voice design ok candidates=%s", len(cands))
        return DesignVoiceResponse(
            source="elevenlabs",
            message=None,
            preview_text_used=text_used,
            candidates=cands,
            normalized_retry_used=normalized_retry_used,
            original_prompt=original_prompt if normalized_retry_used else None,
            rewritten_prompt=rewritten_prompt if normalized_retry_used else None,
        )
    except Exception as e:
        log.warning("voice design failed: %s", e)
        return DesignVoiceResponse(
            source="fallback",
            message=str(e)[:400],
            preview_text_used="",
            candidates=[],
            safe_example_prompts=_SAFE_EXAMPLE_PROMPTS,
        )


def remix_voice(voice_id: str, body: RemixVoiceBody) -> RemixVoiceResponse:
    if not os.environ.get("ELEVENLABS_API_KEY"):
        return RemixVoiceResponse(
            source="fallback",
            message="ELEVENLABS_API_KEY is not set. Voice Remix requires a configured ElevenLabs API key.",
            preview_text_used="",
            candidates=[],
        )
    try:
        text_used, raw = remix_previews(
            voice_id,
            body.remix_prompt,
            body.preview_text,
        )
        files = write_preview_files(raw, "remix")
        cands = [
            VoicePreviewCandidateOut(
                generated_voice_id=x["generated_voice_id"],
                label=x["label"],
                preview_audio_url=x["preview_audio_url"],
                duration_secs=x.get("duration_secs"),
            )
            for x in files[:3]
        ]
        log.info("voice remix ok base=%s candidates=%s", voice_id[:12], len(cands))
        return RemixVoiceResponse(
            source="elevenlabs",
            message=None,
            preview_text_used=text_used,
            candidates=cands,
        )
    except Exception as e:
        log.warning("voice remix failed: %s", e)
        return RemixVoiceResponse(
            source="fallback",
            message=str(e)[:400],
            preview_text_used="",
            candidates=[],
        )


def save_custom_voice(body: SaveCustomVoiceBody) -> SaveCustomVoiceResult:
    if not os.environ.get("ELEVENLABS_API_KEY"):
        raise ValueError("ELEVENLABS_API_KEY is not set")
    st = body.source_type
    if st == "remixed" and not (body.parent_voice_id or "").strip():
        raise ValueError("parent_voice_id is required when saving a remixed voice")
    c = character_service.get_character(body.character_id)
    if not c:
        raise ValueError("Character not found")
    raw = create_voice_from_generated(
        body.voice_name.strip(),
        body.voice_description.strip(),
        body.generated_voice_id.strip(),
    )
    vid = raw.get("voice_id")
    if not vid:
        nested = raw.get("voice")
        if isinstance(nested, dict):
            vid = nested.get("voice_id") or nested.get("id")
    if not vid:
        raise ValueError("ElevenLabs did not return voice_id")
    parent = body.parent_voice_id if st == "remixed" else None
    updated = character_service.update_character(
        body.character_id,
        default_voice_id=vid,
        voice_display_name=body.voice_name.strip(),
        voice_provider="elevenlabs",
        voice_source_type=st,
        voice_parent_id=parent,
        voice_description_meta=body.voice_description.strip(),
    )
    if not updated:
        raise ValueError("Character update failed")
    log.info(
        "saved custom voice character=%s voice_id=%s source=%s",
        body.character_id,
        vid,
        st,
    )
    return SaveCustomVoiceResult(
        character_id=body.character_id,
        voice_id=vid,
        voice_name=body.voice_name.strip(),
        source_type=st,
        provider="elevenlabs",
    )
