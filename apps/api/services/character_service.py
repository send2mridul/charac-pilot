from __future__ import annotations

import logging
from typing import Any

from db.store import CharacterRecord, store
from schemas.character import CharacterOut

log = logging.getLogger("characpilot.character_service")


def list_characters(project_id: str) -> list[CharacterOut]:
    return [_to_out(c) for c in store.list_characters(project_id)]


def get_character(character_id: str) -> CharacterOut | None:
    c = store.get_character(character_id)
    return _to_out(c) if c else None


def create_character_from_group(
    episode_id: str,
    speaker_label: str,
    name: str,
    project_id: str,
) -> CharacterOut:
    existing = store.find_character_by_speaker(episode_id, speaker_label)
    if existing:
        log.info(
            "character already exists for episode=%s speaker=%s -> %s",
            episode_id, speaker_label, existing.id,
        )
        return _to_out(existing)

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
        rec.id, rec.name, episode_id, speaker_label,
    )
    return _to_out(rec)


def update_character(character_id: str, **fields: Any) -> CharacterOut | None:
    rec = store.update_character(character_id, **fields)
    return _to_out(rec) if rec else None


def _to_out(c: CharacterRecord) -> CharacterOut:
    return CharacterOut(
        id=c.id,
        project_id=c.project_id,
        name=c.name,
        role=c.role,
        traits=c.traits,
        wardrobe_notes=c.wardrobe_notes,
        continuity_rules=c.continuity_rules,
        source_speaker_labels=c.source_speaker_labels,
        source_episode_id=c.source_episode_id,
        segment_count=c.segment_count,
        total_speaking_duration=c.total_speaking_duration,
        sample_texts=c.sample_texts,
        is_narrator=c.is_narrator,
        default_voice_id=c.default_voice_id,
        voice_style_presets=c.voice_style_presets,
    )
