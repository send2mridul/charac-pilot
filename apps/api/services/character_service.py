from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from db.store import CharacterRecord, store
from schemas.character import CharacterOut

log = logging.getLogger("characpilot.character_service")


def _enrich_samples_from_transcript(c: CharacterRecord) -> CharacterRecord:
    """
    Fill sample_texts from import transcript segments when the DB snapshot is
    empty or stale. Never uses Voice Studio preview text.
    """
    if not c.source_episode_id or not c.source_speaker_labels:
        return c
    try:
        segs = store.list_transcript_segments(c.source_episode_id)
    except Exception:
        return c
    label_set = set(c.source_speaker_labels)
    matching = [
        s for s in segs if s.speaker_label and s.speaker_label in label_set
    ]
    if not matching:
        return c
    texts_ordered: list[str] = []
    seen: set[str] = set()
    for s in sorted(matching, key=lambda x: (x.start_time, x.segment_id)):
        t = (s.text or "").strip()
        if t and t not in seen:
            seen.add(t)
            texts_ordered.append(t)
    if not texts_ordered:
        return c
    total_dur = sum(max(0.0, s.end_time - s.start_time) for s in matching)
    return replace(
        c,
        sample_texts=texts_ordered[:4],
        segment_count=len(matching),
        total_speaking_duration=round(total_dur, 2),
    )


def list_characters(project_id: str) -> list[CharacterOut]:
    return [
        _to_out(_enrich_samples_from_transcript(c))
        for c in store.list_characters(project_id)
    ]


def get_character(character_id: str) -> CharacterOut | None:
    c = store.get_character(character_id)
    if not c:
        return None
    return _to_out(_enrich_samples_from_transcript(c))


def create_manual_character(
    project_id: str,
    name: str,
    role: str = "",
    wardrobe_notes: str = "",
) -> CharacterOut:
    """Create a character without an episode / speaker group (manual entry)."""
    nm = name.strip() or "Unnamed"
    rec = store.create_character(
        project_id=project_id,
        name=nm,
        role=role.strip(),
        traits=[],
        wardrobe_notes=wardrobe_notes.strip(),
        continuity_rules=[],
        source_speaker_labels=[],
        source_episode_id=None,
        segment_count=0,
        total_speaking_duration=0.0,
        sample_texts=[],
        is_narrator=False,
    )
    log.info("created manual character id=%s name=%s project=%s", rec.id, nm, project_id)
    return _to_out(rec)


def create_character_from_group(
    episode_id: str,
    speaker_label: str,
    name: str,
    project_id: str,
) -> CharacterOut:
    existing = store.find_character_by_speaker(episode_id, speaker_label)
    if existing:
        groups = store.list_speaker_groups(episode_id)
        group = next((g for g in groups if g.speaker_label == speaker_label), None)
        rec: CharacterRecord = existing
        if group:
            updated = store.update_character(
                existing.id,
                sample_texts=list(group.sample_texts),
                segment_count=group.segment_count,
                total_speaking_duration=group.total_speaking_duration,
            )
            if updated is not None:
                rec = updated
        log.info(
            "character already exists for episode=%s speaker=%s -> %s",
            episode_id,
            speaker_label,
            rec.id,
        )
        return _to_out(_enrich_samples_from_transcript(rec))

    groups = store.list_speaker_groups(episode_id)
    group = next((g for g in groups if g.speaker_label == speaker_label), None)

    rec = store.create_character(
        project_id=project_id,
        name=name,
        role="Narrator" if (group and group.is_narrator) else "",
        traits=[],
        wardrobe_notes="",
        continuity_rules=[],
        source_speaker_labels=[speaker_label],
        source_episode_id=episode_id,
        segment_count=group.segment_count if group else 0,
        total_speaking_duration=group.total_speaking_duration if group else 0.0,
        sample_texts=group.sample_texts if group else [],
        is_narrator=group.is_narrator if group else False,
    )
    log.info(
        "created character id=%s name=%s from episode=%s speaker=%s",
        rec.id,
        rec.name,
        episode_id,
        speaker_label,
    )
    return _to_out(_enrich_samples_from_transcript(rec))


def update_character(character_id: str, **fields: Any) -> CharacterOut | None:
    rec = store.update_character(character_id, **fields)
    return _to_out(_enrich_samples_from_transcript(rec)) if rec else None


def delete_character(character_id: str) -> bool:
    return store.delete_character(character_id)


def clear_character_voice(character_id: str) -> CharacterOut | None:
    return update_character(
        character_id,
        default_voice_id=None,
        voice_provider=None,
        voice_display_name=None,
        preview_audio_path=None,
        voice_source_type=None,
        voice_parent_id=None,
    )


def _to_out(c: CharacterRecord) -> CharacterOut:
    return CharacterOut(
        id=c.id,
        project_id=c.project_id,
        name=c.name,
        role=c.role,
        traits=c.traits,
        wardrobe_notes=c.wardrobe_notes,
        continuity_rules=c.continuity_rules,
        thumbnail_paths=c.thumbnail_paths,
        source_speaker_labels=c.source_speaker_labels,
        source_episode_id=c.source_episode_id,
        segment_count=c.segment_count,
        total_speaking_duration=c.total_speaking_duration,
        sample_texts=c.sample_texts,
        is_narrator=c.is_narrator,
        default_voice_id=c.default_voice_id,
        voice_provider=c.voice_provider,
        voice_display_name=c.voice_display_name,
        voice_style_presets=c.voice_style_presets,
        preview_audio_path=c.preview_audio_path,
        voice_source_type=c.voice_source_type,
        voice_parent_id=c.voice_parent_id,
        voice_description_meta=c.voice_description_meta,
    )
