"""Segment dialogue replacement — TTS via ElevenLabs with stub fallback."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from db.store import ReplacementRecord, TranscriptSegmentRecord, _now_iso, store
from schemas.replacement import PatchReplacementBody, ReplacementOut
from services import episode_service
from storage_paths import STORAGE_ROOT, to_rel_storage_path
from services.tts_service import synthesize_line_to_file

log = logging.getLogger("characpilot.replacement")

REPL_ROOT = STORAGE_ROOT / "replacements"


def _audio_url_from_rel(rel: str) -> str:
    rel = rel.replace("\\", "/").lstrip("/")
    return f"/media/{rel}"


def _to_out(r: ReplacementRecord) -> ReplacementOut:
    return ReplacementOut(
        replacement_id=r.replacement_id,
        episode_id=r.episode_id,
        segment_id=r.segment_id,
        character_id=r.character_id,
        character_name=r.character_name,
        selected_voice_id=r.selected_voice_id,
        selected_voice_name=r.selected_voice_name,
        original_text=r.original_text,
        replacement_text=r.replacement_text,
        tone_style=r.tone_style,
        generated_audio_path=r.generated_audio_path,
        audio_url=_audio_url_from_rel(r.generated_audio_path),
        provider_used=r.provider_used,
        fallback_used=r.fallback_used,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _find_segment(episode_id: str, segment_id: str) -> TranscriptSegmentRecord | None:
    for s in store.list_transcript_segments(episode_id):
        if s.segment_id == segment_id:
            return s
    return None


def _unlink_audio(rel_path: str) -> None:
    if not rel_path:
        return
    p = STORAGE_ROOT / rel_path.replace("\\", "/")
    try:
        if p.is_file():
            p.unlink()
            log.info("deleted replacement audio file %s", p)
    except OSError as e:
        log.warning("could not delete audio %s: %s", p, e)


def create_replacement(
    episode_id: str,
    segment_id: str,
    character_id: str,
    replacement_text: str,
    tone_style: str | None,
) -> ReplacementOut:
    episode_service.ensure_uploaded_episode_in_memory(episode_id)
    ep = store.get_episode(episode_id)
    if not ep:
        raise ValueError("Episode not found")

    seg = _find_segment(episode_id, segment_id)
    if not seg:
        raise ValueError("Segment not found")

    ch = store.get_character(character_id)
    if not ch:
        raise ValueError("Character not found")
    if ch.project_id != ep.project_id:
        raise ValueError("Character does not belong to this episode's project")
    if not ch.default_voice_id:
        raise ValueError("Character has no assigned voice — set one in Voice Studio first")

    voice_id = ch.default_voice_id
    voice_name = ch.voice_display_name or ch.default_voice_id

    replacement_id = f"rep-{uuid.uuid4().hex[:12]}"
    out_base = REPL_ROOT / episode_id / segment_id / replacement_id

    text = replacement_text.strip()
    _duration_ms, provider, fallback, final_path = synthesize_line_to_file(
        text,
        voice_id,
        tone_style,
        out_base,
    )

    rel = to_rel_storage_path(final_path)
    ts = _now_iso()

    rec = ReplacementRecord(
        replacement_id=replacement_id,
        episode_id=episode_id,
        segment_id=segment_id,
        character_id=character_id,
        character_name=ch.name,
        selected_voice_id=voice_id,
        selected_voice_name=voice_name,
        original_text=seg.text,
        replacement_text=text,
        tone_style=tone_style.strip() if tone_style else None,
        generated_audio_path=rel,
        provider_used=provider,
        fallback_used=fallback,
        created_at=ts,
        updated_at=ts,
    )
    store.add_replacement(rec)

    log.info(
        "replacement created id=%s episode=%s segment=%s character=%s voice=%s provider=%s fallback=%s",
        replacement_id,
        episode_id,
        segment_id,
        ch.name,
        voice_name,
        provider,
        fallback,
    )
    return _to_out(rec)


def list_replacements(episode_id: str) -> list[ReplacementOut]:
    episode_service.ensure_uploaded_episode_in_memory(episode_id)
    if not store.get_episode(episode_id):
        raise ValueError("Episode not found")
    return [_to_out(r) for r in store.list_replacements(episode_id)]


def patch_replacement(
    episode_id: str,
    replacement_id: str,
    body: PatchReplacementBody,
) -> ReplacementOut:
    episode_service.ensure_uploaded_episode_in_memory(episode_id)
    if not store.get_episode(episode_id):
        raise ValueError("Episode not found")

    existing = store.get_replacement(episode_id, replacement_id)
    if not existing:
        raise ValueError("Replacement not found")

    new_text = (
        body.replacement_text.strip()
        if body.replacement_text is not None
        else existing.replacement_text
    )
    new_tone = existing.tone_style
    if body.tone_style is not None:
        new_tone = body.tone_style.strip() or None

    text_changed = (
        body.replacement_text is not None
        and body.replacement_text.strip() != existing.replacement_text
    )
    tone_changed = body.tone_style is not None and new_tone != existing.tone_style
    regen = body.regenerate_audio or text_changed or tone_changed

    ch = store.get_character(existing.character_id)
    if not ch or not ch.default_voice_id:
        raise ValueError("Character or voice missing for regeneration")

    if regen:
        _unlink_audio(existing.generated_audio_path)
        out_base = REPL_ROOT / episode_id / existing.segment_id / replacement_id
        _duration_ms, provider, fallback, final_path = synthesize_line_to_file(
            new_text,
            ch.default_voice_id,
            new_tone,
            out_base,
        )
        rel = to_rel_storage_path(final_path)
        updated = store.update_replacement(
            episode_id,
            replacement_id,
            replacement_text=new_text,
            tone_style=new_tone,
            generated_audio_path=rel,
            provider_used=provider,
            fallback_used=fallback,
            updated_at=_now_iso(),
        )
    else:
        updated = store.update_replacement(
            episode_id,
            replacement_id,
            replacement_text=new_text,
            tone_style=new_tone,
            updated_at=_now_iso(),
        )

    if not updated:
        raise ValueError("Replacement not found")
    log.info(
        "replacement patched id=%s episode=%s regenerate=%s",
        replacement_id,
        episode_id,
        regen,
    )
    return _to_out(updated)


def delete_replacement(episode_id: str, replacement_id: str) -> None:
    episode_service.ensure_uploaded_episode_in_memory(episode_id)
    rec = store.delete_replacement(episode_id, replacement_id)
    if not rec:
        raise ValueError("Replacement not found")
    _unlink_audio(rec.generated_audio_path)
    log.info("replacement deleted id=%s episode=%s", replacement_id, episode_id)
