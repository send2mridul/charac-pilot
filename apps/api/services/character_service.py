from __future__ import annotations

from db.store import CharacterRecord, store
from schemas.character import CharacterOut


def list_characters(project_id: str) -> list[CharacterOut]:
    return [_to_out(c) for c in store.list_characters(project_id)]


def get_character(character_id: str) -> CharacterOut | None:
    c = store.get_character(character_id)
    return _to_out(c) if c else None


def _to_out(c: CharacterRecord) -> CharacterOut:
    return CharacterOut(
        id=c.id,
        project_id=c.project_id,
        name=c.name,
        role=c.role,
        traits=c.traits,
        wardrobe_notes=c.wardrobe_notes,
        continuity_rules=c.continuity_rules,
    )
