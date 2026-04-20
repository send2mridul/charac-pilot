"""Metadata persistence — SQLite-backed store with stable imports for services and routers."""

from __future__ import annotations

from db.records import (
    STUB_POLL_ADVANCE_TYPES,
    CharacterRecord,
    EpisodeRecord,
    JobRecord,
    ProjectRecord,
    ReplacementRecord,
    SpeakerGroupRecord,
    TranscriptSegmentRecord,
    VoiceClipRecord,
    _now_iso,
)
from db.sqlite_store import SqliteStore
from storage_paths import DATABASE_PATH, ensure_storage_dirs

ensure_storage_dirs()
store = SqliteStore(DATABASE_PATH)

__all__ = [
    "STUB_POLL_ADVANCE_TYPES",
    "CharacterRecord",
    "EpisodeRecord",
    "JobRecord",
    "ProjectRecord",
    "ReplacementRecord",
    "SpeakerGroupRecord",
    "TranscriptSegmentRecord",
    "VoiceClipRecord",
    "_now_iso",
    "store",
]
