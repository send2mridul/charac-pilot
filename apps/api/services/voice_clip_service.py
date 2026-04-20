from __future__ import annotations

from db.records import VoiceClipRecord
from db.store import store
from schemas.voice_clip import VoiceClipOut


def clip_to_out(rec: VoiceClipRecord) -> VoiceClipOut:
    return VoiceClipOut(
        id=rec.id,
        character_id=rec.character_id,
        project_id=rec.project_id,
        voice_id=rec.voice_id,
        voice_name=rec.voice_name,
        text=rec.text,
        tone_style_hint=rec.tone_style_hint,
        audio_url=f"/media/{rec.audio_path}",
        title=rec.title,
        created_at=rec.created_at,
    )


def list_for_character(character_id: str) -> list[VoiceClipOut]:
    return [clip_to_out(r) for r in store.list_voice_clips_for_character(character_id)]


def list_for_project(project_id: str) -> list[VoiceClipOut]:
    return [clip_to_out(r) for r in store.list_voice_clips_for_project(project_id)]
