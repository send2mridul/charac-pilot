"""Voice design / remix orchestration and save-to-character."""

from __future__ import annotations

import logging
import os

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


def design_voice(body: DesignVoiceBody) -> DesignVoiceResponse:
    if not os.environ.get("ELEVENLABS_API_KEY"):
        return DesignVoiceResponse(
            source="fallback",
            message="ELEVENLABS_API_KEY is not set. Voice Design requires a configured ElevenLabs API key.",
            preview_text_used="",
            candidates=[],
        )
    try:
        text_used, raw = design_previews(
            body.voice_description,
            body.preview_text,
            body.model_id,
        )
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
        )
    except Exception as e:
        log.warning("voice design failed: %s", e)
        return DesignVoiceResponse(
            source="fallback",
            message=str(e)[:400],
            preview_text_used="",
            candidates=[],
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
