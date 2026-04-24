"""SQLite-backed metadata store — same public surface as the former in-memory store."""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any

from db.records import (
    STUB_POLL_ADVANCE_TYPES,
    CharacterRecord,
    EpisodeRecord,
    JobRecord,
    ProjectRecord,
    ReplacementRecord,
    SpeakerGroupRecord,
    TranscriptSegmentRecord,
    UserVoiceRecord,
    VoiceClipRecord,
    _now_iso,
)
from storage_paths import STORAGE_ROOT, UPLOADS_ROOT

log = logging.getLogger("characpilot.store")


def _episode_upload_dir_has_media(ep_dir: Path) -> bool:
    if not ep_dir.is_dir():
        return False
    try:
        if (ep_dir / "audio.wav").is_file():
            return True
        if (ep_dir / "transcript.json").is_file():
            return True
        for p in ep_dir.iterdir():
            if not p.is_file():
                continue
            if p.stem.lower() == "source":
                return True
            name = p.name.lower()
            if name.startswith("thumb_") and name.endswith((".jpg", ".jpeg", ".png")):
                return True
    except OSError:
        return False
    return False


def _j(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def _jl(s: str | None, default: list[Any]) -> list[Any]:
    if not s:
        return list(default)
    try:
        out = json.loads(s)
        return out if isinstance(out, list) else list(default)
    except json.JSONDecodeError:
        return list(default)


def _jd(s: str | None) -> dict[str, Any] | None:
    if not s:
        return None
    try:
        out = json.loads(s)
        return out if isinstance(out, dict) else None
    except json.JSONDecodeError:
        return None


class SqliteStore:
    def __init__(self, db_path: str | Path) -> None:
        self._path = Path(db_path)
        self._lock = threading.RLock()
        self._cx = sqlite3.connect(str(self._path), check_same_thread=False)
        self._cx.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._cx.executescript(
            """
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              status TEXT NOT NULL,
              scene_count INTEGER NOT NULL,
              lead TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS episodes (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              title TEXT NOT NULL,
              status TEXT NOT NULL,
              segment_count INTEGER NOT NULL,
              updated_at TEXT NOT NULL,
              source_video_rel TEXT,
              extracted_audio_rel TEXT,
              thumbnail_rels_json TEXT,
              duration_sec REAL,
              transcript_language TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_id);

            CREATE TABLE IF NOT EXISTS characters (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              name TEXT NOT NULL,
              role TEXT NOT NULL,
              traits_json TEXT NOT NULL,
              wardrobe_notes TEXT NOT NULL,
              continuity_rules_json TEXT NOT NULL,
              source_speaker_labels_json TEXT,
              source_episode_id TEXT,
              segment_count INTEGER NOT NULL,
              total_speaking_duration REAL NOT NULL,
              sample_texts_json TEXT,
              thumbnail_paths_json TEXT,
              is_narrator INTEGER NOT NULL DEFAULT 0,
              default_voice_id TEXT,
              voice_provider TEXT,
              voice_display_name TEXT,
              voice_style_presets_json TEXT,
              preview_audio_path TEXT,
              voice_source_type TEXT,
              voice_parent_id TEXT,
              voice_description_meta TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);

            CREATE TABLE IF NOT EXISTS transcript_segments (
              segment_id TEXT PRIMARY KEY,
              episode_id TEXT NOT NULL,
              start_time REAL NOT NULL,
              end_time REAL NOT NULL,
              text TEXT NOT NULL,
              speaker_label TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_transcript_episode ON transcript_segments(episode_id);

            CREATE TABLE IF NOT EXISTS speaker_groups (
              episode_id TEXT NOT NULL,
              speaker_label TEXT NOT NULL,
              display_name TEXT NOT NULL,
              segment_count INTEGER NOT NULL,
              total_speaking_duration REAL NOT NULL,
              sample_texts_json TEXT NOT NULL,
              is_narrator INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (episode_id, speaker_label)
            );

            CREATE TABLE IF NOT EXISTS replacements (
              replacement_id TEXT PRIMARY KEY,
              episode_id TEXT NOT NULL,
              segment_id TEXT NOT NULL,
              character_id TEXT NOT NULL,
              character_name TEXT NOT NULL,
              selected_voice_id TEXT NOT NULL,
              selected_voice_name TEXT NOT NULL,
              original_text TEXT NOT NULL,
              replacement_text TEXT NOT NULL,
              tone_style TEXT,
              generated_audio_path TEXT NOT NULL,
              provider_used TEXT NOT NULL,
              fallback_used INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_replacements_episode ON replacements(episode_id);

            CREATE TABLE IF NOT EXISTS voice_clips (
              id TEXT PRIMARY KEY,
              character_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              voice_id TEXT NOT NULL,
              voice_name TEXT NOT NULL DEFAULT '',
              text TEXT NOT NULL,
              tone_style_hint TEXT NOT NULL DEFAULT '',
              audio_path TEXT NOT NULL,
              title TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_voice_clips_character ON voice_clips(character_id);
            CREATE INDEX IF NOT EXISTS idx_voice_clips_project ON voice_clips(project_id);

            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL,
              status TEXT NOT NULL,
              progress REAL NOT NULL,
              message TEXT NOT NULL,
              poll_count INTEGER NOT NULL DEFAULT 0,
              result_json TEXT,
              episode_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        self._cx.commit()
        self._migrate_schema()

    def _migrate_schema(self) -> None:
        cur = self._cx.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='voice_clips'",
        )
        if cur.fetchone() is None:
            try:
                self._cx.executescript(
                    """
                    CREATE TABLE voice_clips (
                      id TEXT PRIMARY KEY,
                      character_id TEXT NOT NULL,
                      project_id TEXT NOT NULL,
                      voice_id TEXT NOT NULL,
                      voice_name TEXT NOT NULL DEFAULT '',
                      text TEXT NOT NULL,
                      tone_style_hint TEXT NOT NULL DEFAULT '',
                      audio_path TEXT NOT NULL,
                      title TEXT NOT NULL DEFAULT '',
                      created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_voice_clips_character ON voice_clips(character_id);
                    CREATE INDEX IF NOT EXISTS idx_voice_clips_project ON voice_clips(project_id);
                    """,
                )
                self._cx.commit()
            except sqlite3.OperationalError:
                pass

        cur = self._cx.execute("PRAGMA table_info(projects)")
        cols = {row[1] for row in cur.fetchall()}
        if "description" not in cols:
            try:
                self._cx.execute(
                    "ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''",
                )
                self._cx.commit()
            except sqlite3.OperationalError:
                pass

        cur = self._cx.execute("PRAGMA table_info(transcript_segments)")
        tcols = {row[1] for row in cur.fetchall()}
        for col_name, col_typ in (
            ("text_original", "TEXT"),
            ("text_translation_en", "TEXT"),
            ("deleted", "INTEGER DEFAULT 0"),
        ):
            if col_name not in tcols:
                try:
                    self._cx.execute(
                        f"ALTER TABLE transcript_segments ADD COLUMN {col_name} {col_typ}",
                    )
                    self._cx.commit()
                except sqlite3.OperationalError:
                    pass

        cur = self._cx.execute("PRAGMA table_info(characters)")
        ccols = {row[1] for row in cur.fetchall()}
        for col_name, col_typ, col_default in (
            ("source_matched_voice_enabled", "INTEGER", "0"),
            ("source_matched_rights_confirmed", "INTEGER", "0"),
            ("source_matched_rights_type", "TEXT", None),
            ("source_matched_proof_note", "TEXT", None),
            ("source_matched_voice_id", "TEXT", None),
        ):
            if col_name not in ccols:
                try:
                    dflt = f" DEFAULT {col_default}" if col_default is not None else ""
                    self._cx.execute(
                        f"ALTER TABLE characters ADD COLUMN {col_name} {col_typ}{dflt}",
                    )
                    self._cx.commit()
                except sqlite3.OperationalError:
                    pass

        # --- episodes: media_type column ---
        cur = self._cx.execute("PRAGMA table_info(episodes)")
        ecols = {row[1] for row in cur.fetchall()}
        if "media_type" not in ecols:
            try:
                self._cx.execute(
                    "ALTER TABLE episodes ADD COLUMN media_type TEXT DEFAULT 'video'",
                )
                self._cx.commit()
            except sqlite3.OperationalError:
                pass

        # --- replacements: multi-take columns ---
        cur = self._cx.execute("PRAGMA table_info(replacements)")
        rcols = {row[1] for row in cur.fetchall()}
        for col_name, col_typ in (
            ("take_number", "INTEGER DEFAULT 1"),
            ("is_active_take", "INTEGER DEFAULT 1"),
            ("delivery_preset", "TEXT DEFAULT 'neutral'"),
        ):
            if col_name not in rcols:
                try:
                    self._cx.execute(
                        f"ALTER TABLE replacements ADD COLUMN {col_name} {col_typ}",
                    )
                    self._cx.commit()
                except sqlite3.OperationalError:
                    pass

        # --- user_voices table ---
        cur = self._cx.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='user_voices'",
        )
        if cur.fetchone() is None:
            try:
                self._cx.executescript(
                    """
                    CREATE TABLE user_voices (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL,
                      elevenlabs_voice_id TEXT,
                      source_type TEXT NOT NULL,
                      sample_audio_path TEXT,
                      rights_type TEXT NOT NULL,
                      rights_note TEXT NOT NULL DEFAULT '',
                      preview_audio_path TEXT,
                      created_at TEXT NOT NULL
                    );
                    """,
                )
                self._cx.commit()
            except sqlite3.OperationalError:
                pass

        # --- user_id columns for ownership isolation ---
        cur = self._cx.execute("PRAGMA table_info(projects)")
        pcols = {row[1] for row in cur.fetchall()}
        if "user_id" not in pcols:
            try:
                self._cx.execute("ALTER TABLE projects ADD COLUMN user_id TEXT")
                self._cx.execute("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)")
                self._cx.commit()
                log.info("migration: added user_id column to projects")
            except sqlite3.OperationalError:
                pass

        cur = self._cx.execute("PRAGMA table_info(user_voices)")
        uvcols = {row[1] for row in cur.fetchall()}
        if "user_id" not in uvcols:
            try:
                self._cx.execute("ALTER TABLE user_voices ADD COLUMN user_id TEXT")
                self._cx.execute("CREATE INDEX IF NOT EXISTS idx_user_voices_user ON user_voices(user_id)")
                self._cx.commit()
                log.info("migration: added user_id column to user_voices")
            except sqlite3.OperationalError:
                pass

    def renormalize_hindi_display_text(self) -> None:
        """Re-derive display text for Hindi segments that have text_original.

        Fixes stale data from earlier code that over-aggressively replaced lines
        with placeholders or stripped transliterated content to punctuation-only.
        Runs once at startup; handles both DB-tracked and disk-only transcripts.
        """
        from services.transcript_text_normalize import (
            finalize_segment_fields,
            is_hindi_language,
            normalize_video_indexer_language,
            HINDI_PLACEHOLDER_DISPLAY,
        )

        _STALE_ARTIFACT_RE = re.compile(r"[a-z]\s+\d\s+[a-z]")

        def _needs_fix(cur_text: str) -> bool:
            s = cur_text.strip()
            if s == HINDI_PLACEHOLDER_DISPLAY:
                return True
            has_latin = any("A" <= c <= "Z" or "a" <= c <= "z" for c in s)
            if not has_latin or (has_latin and len(s) < 4):
                return True
            if _STALE_ARTIFACT_RE.search(s):
                return True
            return False

        # --- Part 1: DB-tracked Hindi episodes ---
        with self._lock:
            hi_eps = self._cx.execute(
                "SELECT id, transcript_language FROM episodes WHERE transcript_language IS NOT NULL"
            ).fetchall()

        hindi_episode_ids: list[tuple[str, str | None]] = []
        for r in hi_eps:
            lang = normalize_video_indexer_language(r["transcript_language"])
            if is_hindi_language(lang):
                hindi_episode_ids.append((r["id"], lang))

        total_fixed = 0
        for ep_id, lang in hindi_episode_ids:
            with self._lock:
                rows = self._cx.execute(
                    "SELECT segment_id, text, text_original FROM transcript_segments WHERE episode_id = ?",
                    (ep_id,),
                ).fetchall()

            updates: list[tuple[str, str, str]] = []
            for row in rows:
                orig = row["text_original"]
                if not orig:
                    continue
                if not _needs_fix(row["text"] or ""):
                    continue
                new_disp, _, _ = finalize_segment_fields(episode_language=lang, raw_text=orig)
                if new_disp and new_disp != HINDI_PLACEHOLDER_DISPLAY and new_disp != (row["text"] or "").strip():
                    updates.append((new_disp, orig, row["segment_id"]))

            if not updates:
                continue

            log.info(
                "hindi_renormalize touched episode_id=%s rows=%d",
                ep_id,
                len(updates),
            )

            with self._lock:
                for new_text, _orig, seg_id in updates:
                    self._cx.execute(
                        "UPDATE transcript_segments SET text = ? WHERE segment_id = ?",
                        (new_text, seg_id),
                    )
                self._cx.commit()
            total_fixed += len(updates)

            all_segs = self.list_transcript_segments(ep_id, include_deleted=True)
            self._persist_transcript_json(ep_id, all_segs, lang)

        # --- Part 2: disk-only transcript.json files not in DB ---
        disk_fixed = 0
        if UPLOADS_ROOT.is_dir():
            for proj_dir in sorted(UPLOADS_ROOT.iterdir()):
                if not proj_dir.is_dir():
                    continue
                for ep_dir in sorted(proj_dir.iterdir()):
                    if not ep_dir.is_dir():
                        continue
                    tpath = ep_dir / "transcript.json"
                    if not tpath.is_file():
                        continue
                    ep_id = ep_dir.name
                    with self._lock:
                        in_db = self._cx.execute(
                            "SELECT 1 FROM episodes WHERE id = ?", (ep_id,)
                        ).fetchone()
                    if in_db:
                        continue
                    try:
                        payload = json.loads(tpath.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        continue
                    lang = normalize_video_indexer_language(payload.get("language"))
                    if not is_hindi_language(lang):
                        continue
                    segs = payload.get("segments", [])
                    changed = False
                    for seg in segs:
                        orig = seg.get("text_original")
                        if not orig:
                            continue
                        if not _needs_fix(seg.get("text", "")):
                            continue
                        new_disp, _, _ = finalize_segment_fields(episode_language=lang, raw_text=orig)
                        if new_disp and new_disp != HINDI_PLACEHOLDER_DISPLAY:
                            seg["text"] = new_disp
                            changed = True
                            disk_fixed += 1
                    if changed:
                        try:
                            tpath.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
                        except OSError:
                            pass

        total_fixed += disk_fixed
        if total_fixed:
            log.info(
                "hindi_renormalize: fixed %d stale display segments (db=%d disk=%d)",
                total_fixed,
                total_fixed - disk_fixed,
                disk_fixed,
            )

    def _row_project(self, r: sqlite3.Row) -> ProjectRecord:
        desc = ""
        try:
            desc = str(r["description"] or "")
        except (KeyError, IndexError):
            pass
        uid = None
        try:
            uid = r["user_id"]
        except (KeyError, IndexError):
            pass
        return ProjectRecord(
            id=r["id"],
            name=r["name"],
            status=r["status"],
            scene_count=int(r["scene_count"]),
            lead=r["lead"],
            updated_at=r["updated_at"],
            description=desc,
            user_id=uid,
        )

    def _row_episode(self, r: sqlite3.Row) -> EpisodeRecord:
        thumbs = _jl(r["thumbnail_rels_json"], [])
        keys = r.keys() if hasattr(r, "keys") else []
        return EpisodeRecord(
            id=r["id"],
            project_id=r["project_id"],
            title=r["title"],
            status=r["status"],
            segment_count=int(r["segment_count"]),
            updated_at=r["updated_at"],
            source_video_rel=r["source_video_rel"],
            extracted_audio_rel=r["extracted_audio_rel"],
            thumbnail_rels=[str(x) for x in thumbs],
            duration_sec=float(r["duration_sec"]) if r["duration_sec"] is not None else None,
            transcript_language=r["transcript_language"],
            media_type=r["media_type"] if "media_type" in keys else "video",
        )

    def _row_character(self, r: sqlite3.Row) -> CharacterRecord:
        return CharacterRecord(
            id=r["id"],
            project_id=r["project_id"],
            name=r["name"],
            role=r["role"],
            traits=[str(x) for x in _jl(r["traits_json"], [])],
            wardrobe_notes=r["wardrobe_notes"] or "",
            continuity_rules=[str(x) for x in _jl(r["continuity_rules_json"], [])],
            source_speaker_labels=[str(x) for x in _jl(r["source_speaker_labels_json"], [])],
            source_episode_id=r["source_episode_id"],
            segment_count=int(r["segment_count"]),
            total_speaking_duration=float(r["total_speaking_duration"] or 0),
            sample_texts=[str(x) for x in _jl(r["sample_texts_json"], [])],
            thumbnail_paths=[str(x) for x in _jl(r["thumbnail_paths_json"], [])],
            is_narrator=bool(r["is_narrator"]),
            default_voice_id=r["default_voice_id"],
            voice_provider=r["voice_provider"],
            voice_display_name=r["voice_display_name"],
            voice_style_presets=_jd(r["voice_style_presets_json"]),
            preview_audio_path=r["preview_audio_path"],
            voice_source_type=r["voice_source_type"],
            voice_parent_id=r["voice_parent_id"],
            voice_description_meta=r["voice_description_meta"],
            source_matched_voice_enabled=bool(r["source_matched_voice_enabled"] if "source_matched_voice_enabled" in r.keys() else 0),
            source_matched_rights_confirmed=bool(r["source_matched_rights_confirmed"] if "source_matched_rights_confirmed" in r.keys() else 0),
            source_matched_rights_type=r["source_matched_rights_type"] if "source_matched_rights_type" in r.keys() else None,
            source_matched_proof_note=r["source_matched_proof_note"] if "source_matched_proof_note" in r.keys() else None,
            source_matched_voice_id=r["source_matched_voice_id"] if "source_matched_voice_id" in r.keys() else None,
        )

    def _row_segment(self, r: sqlite3.Row) -> TranscriptSegmentRecord:
        def _col_str(key: str) -> str | None:
            try:
                v = r[key]
            except (KeyError, IndexError):
                return None
            if v is None:
                return None
            return str(v)

        def _col_int(key: str) -> int:
            try:
                v = r[key]
            except (KeyError, IndexError):
                return 0
            if v is None:
                return 0
            try:
                return int(v)
            except (TypeError, ValueError):
                return 0

        return TranscriptSegmentRecord(
            segment_id=r["segment_id"],
            episode_id=r["episode_id"],
            start_time=float(r["start_time"]),
            end_time=float(r["end_time"]),
            text=r["text"],
            speaker_label=r["speaker_label"],
            text_original=_col_str("text_original"),
            text_translation_en=_col_str("text_translation_en"),
            deleted=_col_int("deleted"),
        )

    def _row_speaker_group(self, r: sqlite3.Row) -> SpeakerGroupRecord:
        return SpeakerGroupRecord(
            speaker_label=r["speaker_label"],
            episode_id=r["episode_id"],
            display_name=r["display_name"],
            segment_count=int(r["segment_count"]),
            total_speaking_duration=float(r["total_speaking_duration"]),
            sample_texts=[str(x) for x in _jl(r["sample_texts_json"], [])],
            is_narrator=bool(r["is_narrator"]),
        )

    def _row_replacement(self, r: sqlite3.Row) -> ReplacementRecord:
        keys = r.keys() if hasattr(r, "keys") else []
        return ReplacementRecord(
            replacement_id=r["replacement_id"],
            episode_id=r["episode_id"],
            segment_id=r["segment_id"],
            character_id=r["character_id"],
            character_name=r["character_name"],
            selected_voice_id=r["selected_voice_id"],
            selected_voice_name=r["selected_voice_name"],
            original_text=r["original_text"],
            replacement_text=r["replacement_text"],
            tone_style=r["tone_style"],
            generated_audio_path=r["generated_audio_path"],
            provider_used=r["provider_used"],
            fallback_used=bool(r["fallback_used"]),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            take_number=int(r["take_number"]) if "take_number" in keys and r["take_number"] is not None else 1,
            is_active_take=int(r["is_active_take"]) if "is_active_take" in keys and r["is_active_take"] is not None else 1,
            delivery_preset=r["delivery_preset"] if "delivery_preset" in keys and r["delivery_preset"] else "neutral",
        )

    def _row_job(self, r: sqlite3.Row) -> JobRecord:
        return JobRecord(
            id=r["id"],
            type=r["type"],
            status=r["status"],
            progress=float(r["progress"]),
            message=r["message"],
            poll_count=int(r["poll_count"] or 0),
            result=_jd(r["result_json"]),
            episode_id=r["episode_id"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    def list_projects(self, *, user_id: str | None = None) -> list[ProjectRecord]:
        with self._lock:
            if user_id:
                cur = self._cx.execute(
                    "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
                    (user_id,),
                )
            else:
                cur = self._cx.execute(
                    "SELECT * FROM projects ORDER BY updated_at DESC",
                )
            rows = cur.fetchall()
        return [self._row_project(r) for r in rows]

    def get_project(self, project_id: str, *, user_id: str | None = None) -> ProjectRecord | None:
        with self._lock:
            if user_id:
                cur = self._cx.execute(
                    "SELECT * FROM projects WHERE id = ? AND user_id = ?",
                    (project_id, user_id),
                )
            else:
                cur = self._cx.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
            r = cur.fetchone()
        return self._row_project(r) if r else None

    def create_project(self, name: str, lead: str, description: str = "", *, user_id: str | None = None) -> ProjectRecord:
        pid = f"p-{uuid.uuid4().hex[:8]}"
        ts = _now_iso()
        rec = ProjectRecord(
            id=pid,
            name=name,
            status="active",
            scene_count=0,
            lead=lead,
            updated_at=ts,
            description=description.strip(),
            user_id=user_id,
        )
        with self._lock:
            self._cx.execute(
                """INSERT INTO projects (id, name, status, scene_count, lead, updated_at, description, user_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    rec.id,
                    rec.name,
                    rec.status,
                    rec.scene_count,
                    rec.lead,
                    rec.updated_at,
                    rec.description,
                    rec.user_id,
                ),
            )
            self._cx.commit()
        return rec

    def update_project(self, project_id: str, **fields: Any) -> ProjectRecord | None:
        allowed = {"name", "lead", "description", "status", "scene_count"}
        with self._lock:
            cur = self._cx.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
            r = cur.fetchone()
            if not r:
                return None
            p = self._row_project(r)
            for key, val in fields.items():
                if key in allowed:
                    setattr(p, key, val)
            p.updated_at = _now_iso()
            self._cx.execute(
                """UPDATE projects SET name=?, status=?, scene_count=?, lead=?, updated_at=?, description=?
                   WHERE id=?""",
                (
                    p.name,
                    p.status,
                    p.scene_count,
                    p.lead,
                    p.updated_at,
                    p.description,
                    project_id,
                ),
            )
            self._cx.commit()
        return p

    def delete_project(self, project_id: str) -> bool:
        from services.r2_storage import bucket_for_key, delete_object, r2_configured
        with self._lock:
            cur_clips = self._cx.execute(
                "SELECT audio_path FROM voice_clips WHERE project_id = ?",
                (project_id,),
            )
            for row in cur_clips.fetchall():
                rel = str(row[0] or "")
                if not rel:
                    continue
                p = STORAGE_ROOT / rel
                if p.is_file():
                    try:
                        p.unlink()
                    except OSError:
                        pass
                if r2_configured():
                    key = rel.replace("\\", "/")
                    delete_object(bucket_for_key(key), key)
            self._cx.execute(
                "DELETE FROM voice_clips WHERE project_id = ?",
                (project_id,),
            )
            cur = self._cx.execute(
                "SELECT id FROM episodes WHERE project_id = ?",
                (project_id,),
            )
            ep_ids = [str(row[0]) for row in cur.fetchall()]
            for eid in ep_ids:
                self._cx.execute(
                    "DELETE FROM transcript_segments WHERE episode_id = ?",
                    (eid,),
                )
                self._cx.execute(
                    "DELETE FROM speaker_groups WHERE episode_id = ?",
                    (eid,),
                )
                self._cx.execute(
                    "DELETE FROM replacements WHERE episode_id = ?",
                    (eid,),
                )
                self._cx.execute("DELETE FROM jobs WHERE episode_id = ?", (eid,))
            self._cx.execute("DELETE FROM episodes WHERE project_id = ?", (project_id,))
            self._cx.execute("DELETE FROM characters WHERE project_id = ?", (project_id,))
            del_cur = self._cx.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            n = del_cur.rowcount or 0
            self._cx.commit()
        return n > 0

    def _row_voice_clip(self, r: sqlite3.Row) -> VoiceClipRecord:
        return VoiceClipRecord(
            id=r["id"],
            character_id=r["character_id"],
            project_id=r["project_id"],
            voice_id=r["voice_id"] or "",
            voice_name=r["voice_name"] or "",
            text=r["text"] or "",
            tone_style_hint=r["tone_style_hint"] or "",
            audio_path=r["audio_path"] or "",
            title=r["title"] or "",
            created_at=r["created_at"] or "",
        )

    def create_voice_clip(
        self,
        *,
        character_id: str,
        project_id: str,
        voice_id: str,
        voice_name: str,
        text: str,
        tone_style_hint: str,
        audio_path: str,
        title: str = "",
    ) -> VoiceClipRecord:
        clip_id = f"vcp-{uuid.uuid4().hex[:12]}"
        now = _now_iso()
        rec = VoiceClipRecord(
            id=clip_id,
            character_id=character_id,
            project_id=project_id,
            voice_id=voice_id,
            voice_name=voice_name,
            text=text,
            tone_style_hint=tone_style_hint,
            audio_path=audio_path,
            title=title.strip() or f"Clip {clip_id[-6:]}",
            created_at=now,
        )
        with self._lock:
            self._cx.execute(
                """INSERT INTO voice_clips (
                  id, character_id, project_id, voice_id, voice_name, text,
                  tone_style_hint, audio_path, title, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    rec.id,
                    rec.character_id,
                    rec.project_id,
                    rec.voice_id,
                    rec.voice_name,
                    rec.text,
                    rec.tone_style_hint,
                    rec.audio_path,
                    rec.title,
                    rec.created_at,
                ),
            )
            self._cx.commit()
        return rec

    def list_voice_clips_for_character(self, character_id: str) -> list[VoiceClipRecord]:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM voice_clips WHERE character_id = ? ORDER BY created_at DESC",
                (character_id,),
            )
            rows = cur.fetchall()
        return [self._row_voice_clip(r) for r in rows]

    def list_voice_clips_for_project(self, project_id: str) -> list[VoiceClipRecord]:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM voice_clips WHERE project_id = ? ORDER BY created_at DESC",
                (project_id,),
            )
            rows = cur.fetchall()
        return [self._row_voice_clip(r) for r in rows]

    def get_voice_clip(self, clip_id: str) -> VoiceClipRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM voice_clips WHERE id = ?", (clip_id,))
            r = cur.fetchone()
        return self._row_voice_clip(r) if r else None

    def patch_voice_clip(self, clip_id: str, *, title: str | None = None) -> VoiceClipRecord | None:
        rec = self.get_voice_clip(clip_id)
        if not rec:
            return None
        new_title = rec.title
        if title is not None:
            new_title = title.strip() or rec.title
        with self._lock:
            self._cx.execute(
                "UPDATE voice_clips SET title=? WHERE id=?",
                (new_title, clip_id),
            )
            self._cx.commit()
        return self.get_voice_clip(clip_id)

    def delete_voice_clip(self, clip_id: str) -> bool:
        rec = self.get_voice_clip(clip_id)
        if not rec:
            return False
        p = STORAGE_ROOT / rec.audio_path
        if p.is_file():
            try:
                p.unlink()
            except OSError:
                pass
        from services.r2_storage import bucket_for_key, delete_object, r2_configured
        if r2_configured() and rec.audio_path:
            key = rec.audio_path.replace("\\", "/")
            delete_object(bucket_for_key(key), key)
        with self._lock:
            cur = self._cx.execute("DELETE FROM voice_clips WHERE id = ?", (clip_id,))
            n = cur.rowcount or 0
            self._cx.commit()
        return n > 0

    def list_episodes(self, project_id: str) -> list[EpisodeRecord]:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM episodes WHERE project_id = ? ORDER BY title",
                (project_id,),
            )
            rows = cur.fetchall()
        return [self._row_episode(r) for r in rows]

    def list_characters(self, project_id: str) -> list[CharacterRecord]:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM characters WHERE project_id = ? ORDER BY name",
                (project_id,),
            )
            rows = cur.fetchall()
        return [self._row_character(r) for r in rows]

    def get_character(self, character_id: str) -> CharacterRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM characters WHERE id = ?", (character_id,))
            r = cur.fetchone()
        return self._row_character(r) if r else None

    def _insert_character(self, rec: CharacterRecord) -> None:
        self._cx.execute(
            """INSERT INTO characters (
              id, project_id, name, role, traits_json, wardrobe_notes, continuity_rules_json,
              source_speaker_labels_json, source_episode_id, segment_count, total_speaking_duration,
              sample_texts_json, thumbnail_paths_json, is_narrator,
              default_voice_id, voice_provider, voice_display_name, voice_style_presets_json,
              preview_audio_path, voice_source_type, voice_parent_id, voice_description_meta,
              source_matched_voice_enabled, source_matched_rights_confirmed,
              source_matched_rights_type, source_matched_proof_note, source_matched_voice_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                rec.id,
                rec.project_id,
                rec.name,
                rec.role,
                _j(rec.traits),
                rec.wardrobe_notes,
                _j(rec.continuity_rules),
                _j(rec.source_speaker_labels),
                rec.source_episode_id,
                rec.segment_count,
                rec.total_speaking_duration,
                _j(rec.sample_texts),
                _j(rec.thumbnail_paths),
                1 if rec.is_narrator else 0,
                rec.default_voice_id,
                rec.voice_provider,
                rec.voice_display_name,
                _j(rec.voice_style_presets) if rec.voice_style_presets is not None else None,
                rec.preview_audio_path,
                rec.voice_source_type,
                rec.voice_parent_id,
                rec.voice_description_meta,
                1 if rec.source_matched_voice_enabled else 0,
                1 if rec.source_matched_rights_confirmed else 0,
                rec.source_matched_rights_type,
                rec.source_matched_proof_note,
                rec.source_matched_voice_id,
            ),
        )

    def create_character(self, **fields: Any) -> CharacterRecord:
        cid = f"chr-{uuid.uuid4().hex[:10]}"
        rec = CharacterRecord(
            id=cid,
            project_id=fields.get("project_id", ""),
            name=fields.get("name", "Unnamed"),
            role=fields.get("role", ""),
            traits=fields.get("traits", []),
            wardrobe_notes=fields.get("wardrobe_notes", ""),
            continuity_rules=fields.get("continuity_rules", []),
            source_speaker_labels=fields.get("source_speaker_labels", []),
            source_episode_id=fields.get("source_episode_id"),
            segment_count=fields.get("segment_count", 0),
            total_speaking_duration=fields.get("total_speaking_duration", 0.0),
            sample_texts=fields.get("sample_texts", []),
            thumbnail_paths=fields.get("thumbnail_paths", []),
            is_narrator=fields.get("is_narrator", False),
            default_voice_id=fields.get("default_voice_id"),
            voice_provider=fields.get("voice_provider"),
            voice_display_name=fields.get("voice_display_name"),
            voice_style_presets=fields.get("voice_style_presets"),
            preview_audio_path=fields.get("preview_audio_path"),
            voice_source_type=fields.get("voice_source_type"),
            voice_parent_id=fields.get("voice_parent_id"),
            voice_description_meta=fields.get("voice_description_meta"),
            source_matched_voice_enabled=fields.get("source_matched_voice_enabled", False),
            source_matched_rights_confirmed=fields.get("source_matched_rights_confirmed", False),
            source_matched_rights_type=fields.get("source_matched_rights_type"),
            source_matched_proof_note=fields.get("source_matched_proof_note"),
            source_matched_voice_id=fields.get("source_matched_voice_id"),
        )
        with self._lock:
            self._insert_character(rec)
            self._cx.commit()
        return rec

    def update_character(self, character_id: str, **fields: Any) -> CharacterRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM characters WHERE id = ?", (character_id,))
            r = cur.fetchone()
            if not r:
                return None
            c = self._row_character(r)
            for key, val in fields.items():
                if hasattr(c, key):
                    setattr(c, key, val)
            self._cx.execute("DELETE FROM characters WHERE id = ?", (character_id,))
            self._insert_character(c)
            self._cx.commit()
        return c

    def delete_character(self, character_id: str) -> bool:
        """Remove character row and associated voice clips (audio files on disk)."""
        with self._lock:
            cur = self._cx.execute("SELECT * FROM characters WHERE id = ?", (character_id,))
            r = cur.fetchone()
            if not r:
                return False
            clip_cur = self._cx.execute(
                "SELECT audio_path FROM voice_clips WHERE character_id = ?",
                (character_id,),
            )
            clip_paths = [str(row[0] or "") for row in clip_cur.fetchall()]
        for rel in clip_paths:
            if not rel:
                continue
            p = STORAGE_ROOT / rel
            if p.is_file():
                try:
                    p.unlink()
                except OSError:
                    pass
        with self._lock:
            self._cx.execute("DELETE FROM voice_clips WHERE character_id = ?", (character_id,))
            del_cur = self._cx.execute("DELETE FROM characters WHERE id = ?", (character_id,))
            n = del_cur.rowcount or 0
            self._cx.commit()
        return n > 0

    def delete_episode(self, episode_id: str) -> bool:
        """Remove episode metadata, transcript, groups, jobs; unlink characters from this import."""
        with self._lock:
            cur = self._cx.execute("SELECT id FROM episodes WHERE id = ?", (episode_id,))
            if not cur.fetchone():
                return False
            self._cx.execute("DELETE FROM transcript_segments WHERE episode_id = ?", (episode_id,))
            self._cx.execute("DELETE FROM speaker_groups WHERE episode_id = ?", (episode_id,))
            self._cx.execute("DELETE FROM replacements WHERE episode_id = ?", (episode_id,))
            self._cx.execute("DELETE FROM jobs WHERE episode_id = ?", (episode_id,))
            self._cx.execute(
                "UPDATE characters SET source_episode_id = NULL WHERE source_episode_id = ?",
                (episode_id,),
            )
            del_cur = self._cx.execute("DELETE FROM episodes WHERE id = ?", (episode_id,))
            n = del_cur.rowcount or 0
            self._cx.commit()
        return n > 0

    def find_character_by_speaker(self, episode_id: str, speaker_label: str) -> CharacterRecord | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM characters WHERE source_episode_id = ?",
                (episode_id,),
            )
            rows = cur.fetchall()
        for r in rows:
            c = self._row_character(r)
            if speaker_label in c.source_speaker_labels:
                return c
        return None

    def get_episode(self, episode_id: str) -> EpisodeRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM episodes WHERE id = ?", (episode_id,))
            r = cur.fetchone()
        return self._row_episode(r) if r else None

    def _replace_transcript_segments(
        self,
        episode_id: str,
        segments: list[TranscriptSegmentRecord],
    ) -> None:
        self._cx.execute("DELETE FROM transcript_segments WHERE episode_id = ?", (episode_id,))
        for s in segments:
            self._cx.execute(
                """INSERT INTO transcript_segments
                   (segment_id, episode_id, start_time, end_time, text, speaker_label,
                    text_original, text_translation_en, deleted)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    s.segment_id,
                    s.episode_id,
                    s.start_time,
                    s.end_time,
                    s.text,
                    s.speaker_label,
                    s.text_original,
                    s.text_translation_en,
                    int(getattr(s, "deleted", 0) or 0),
                ),
            )

    def set_transcript_for_episode(
        self,
        episode_id: str,
        segments: list[TranscriptSegmentRecord],
        language: str | None = None,
    ) -> None:
        had_ep_row = False
        with self._lock:
            self._replace_transcript_segments(episode_id, segments)
            ep = self.get_episode(episode_id)
            if ep:
                had_ep_row = True
                ts = _now_iso()
                if language:
                    self._cx.execute(
                        """UPDATE episodes SET segment_count = ?, transcript_language = ?, updated_at = ?
                           WHERE id = ?""",
                        (len(segments), language, ts, episode_id),
                    )
                else:
                    self._cx.execute(
                        """UPDATE episodes SET segment_count = ?, updated_at = ? WHERE id = ?""",
                        (len(segments), ts, episode_id),
                    )
            self._cx.commit()
        log.info(
            "transcript saved episode_id=%s segments=%s language=%s episode_row=%s",
            episode_id,
            len(segments),
            language,
            had_ep_row,
        )
        self._persist_transcript_json(episode_id, segments, language)

    def list_replacements(self, episode_id: str) -> list[ReplacementRecord]:
        with self._lock:
            cur = self._cx.execute(
                """SELECT * FROM replacements WHERE episode_id = ?
                   ORDER BY created_at""",
                (episode_id,),
            )
            rows = cur.fetchall()
        return [self._row_replacement(r) for r in rows]

    def list_replacements_for_project(self, project_id: str) -> list[ReplacementRecord]:
        with self._lock:
            cur = self._cx.execute(
                """SELECT r.* FROM replacements r
                   INNER JOIN episodes e ON e.id = r.episode_id
                   WHERE e.project_id = ?
                   ORDER BY r.created_at DESC""",
                (project_id,),
            )
            rows = cur.fetchall()
        return [self._row_replacement(r) for r in rows]

    def add_replacement(self, rec: ReplacementRecord) -> ReplacementRecord:
        with self._lock:
            self._cx.execute(
                """INSERT INTO replacements (
                  replacement_id, episode_id, segment_id, character_id, character_name,
                  selected_voice_id, selected_voice_name, original_text, replacement_text,
                  tone_style, generated_audio_path, provider_used, fallback_used,
                  created_at, updated_at, take_number, is_active_take, delivery_preset
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rec.replacement_id,
                    rec.episode_id,
                    rec.segment_id,
                    rec.character_id,
                    rec.character_name,
                    rec.selected_voice_id,
                    rec.selected_voice_name,
                    rec.original_text,
                    rec.replacement_text,
                    rec.tone_style,
                    rec.generated_audio_path,
                    rec.provider_used,
                    1 if rec.fallback_used else 0,
                    rec.created_at,
                    rec.updated_at,
                    rec.take_number,
                    rec.is_active_take,
                    rec.delivery_preset,
                ),
            )
            self._cx.commit()
        return rec

    def get_replacement(self, episode_id: str, replacement_id: str) -> ReplacementRecord | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM replacements WHERE episode_id = ? AND replacement_id = ?",
                (episode_id, replacement_id),
            )
            r = cur.fetchone()
        return self._row_replacement(r) if r else None

    def update_replacement(
        self,
        episode_id: str,
        replacement_id: str,
        **fields: Any,
    ) -> ReplacementRecord | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM replacements WHERE episode_id = ? AND replacement_id = ?",
                (episode_id, replacement_id),
            )
            r = cur.fetchone()
            if not r:
                return None
            rep = self._row_replacement(r)
            for key, val in fields.items():
                if hasattr(rep, key):
                    setattr(rep, key, val)
            self._cx.execute(
                "DELETE FROM replacements WHERE replacement_id = ?",
                (replacement_id,),
            )
            self._cx.execute(
                """INSERT INTO replacements (
                  replacement_id, episode_id, segment_id, character_id, character_name,
                  selected_voice_id, selected_voice_name, original_text, replacement_text,
                  tone_style, generated_audio_path, provider_used, fallback_used,
                  created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rep.replacement_id,
                    rep.episode_id,
                    rep.segment_id,
                    rep.character_id,
                    rep.character_name,
                    rep.selected_voice_id,
                    rep.selected_voice_name,
                    rep.original_text,
                    rep.replacement_text,
                    rep.tone_style,
                    rep.generated_audio_path,
                    rep.provider_used,
                    1 if rep.fallback_used else 0,
                    rep.created_at,
                    rep.updated_at,
                ),
            )
            self._cx.commit()
        return rep

    def delete_replacement(self, episode_id: str, replacement_id: str) -> ReplacementRecord | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM replacements WHERE episode_id = ? AND replacement_id = ?",
                (episode_id, replacement_id),
            )
            r = cur.fetchone()
            if not r:
                return None
            rep = self._row_replacement(r)
            self._cx.execute(
                "DELETE FROM replacements WHERE episode_id = ? AND replacement_id = ?",
                (episode_id, replacement_id),
            )
            self._cx.commit()
        return rep

    def _load_segments_db(self, episode_id: str, *, include_deleted: bool = False) -> list[TranscriptSegmentRecord]:
        if include_deleted:
            sql = "SELECT * FROM transcript_segments WHERE episode_id = ? ORDER BY start_time, segment_id"
        else:
            sql = "SELECT * FROM transcript_segments WHERE episode_id = ? AND COALESCE(deleted, 0) = 0 ORDER BY start_time, segment_id"
        cur = self._cx.execute(sql, (episode_id,))
        return [self._row_segment(r) for r in cur.fetchall()]

    def soft_delete_segment(self, episode_id: str, segment_id: str) -> bool:
        with self._lock:
            cur = self._cx.execute(
                "UPDATE transcript_segments SET deleted = 1 WHERE episode_id = ? AND segment_id = ?",
                (episode_id, segment_id),
            )
            self._cx.commit()
            changed = cur.rowcount > 0
        if changed:
            try:
                ep = self.get_episode(episode_id)
                lang = ep.transcript_language if ep else None
                all_segs = self.list_transcript_segments(episode_id, include_deleted=True)
                self._persist_transcript_json(episode_id, all_segs, lang)
            except Exception:
                log.warning(
                    "soft_delete_segment: failed to persist transcript.json episode_id=%s",
                    episode_id,
                )
        return changed

    def patch_transcript_segment_text(
        self,
        episode_id: str,
        segment_id: str,
        text: str,
    ) -> TranscriptSegmentRecord | None:
        """Save edited transcript line text without TTS.

        English: stores the edited string as ``text`` and clears ``text_original``.

        Hindi: runs ``finalize_segment_fields`` so Roman display + Devanagari
        ``text_original`` stay aligned (same as import pipeline). Latin-only edits
        clear ``text_original``.
        """
        from services.transcript_text_normalize import (
            finalize_segment_fields,
            is_hindi_language,
            normalize_video_indexer_language,
        )

        tid = segment_id.strip()
        new_text = (text or "").strip()
        if not new_text:
            return None
        with self._lock:
            cur = self._cx.execute(
                """SELECT * FROM transcript_segments
                   WHERE episode_id = ? AND segment_id = ? AND COALESCE(deleted, 0) = 0""",
                (episode_id, tid),
            )
            r = cur.fetchone()
            if not r:
                return None
            ep_row = self._cx.execute(
                "SELECT transcript_language FROM episodes WHERE id = ?",
                (episode_id,),
            ).fetchone()
            lang = normalize_video_indexer_language(
                ep_row["transcript_language"] if ep_row else None,
            )
            if is_hindi_language(lang):
                disp, orig, _tr = finalize_segment_fields(
                    episode_language=lang,
                    raw_text=new_text,
                )
                if not disp:
                    return None
                text_to_store = disp
                orig_to_store = orig
            else:
                text_to_store = new_text
                orig_to_store = None
            self._cx.execute(
                """UPDATE transcript_segments
                   SET text = ?, text_original = ?
                   WHERE episode_id = ? AND segment_id = ?""",
                (text_to_store, orig_to_store, episode_id, tid),
            )
            self._cx.commit()
            cur2 = self._cx.execute(
                "SELECT * FROM transcript_segments WHERE episode_id = ? AND segment_id = ?",
                (episode_id, tid),
            )
            row2 = cur2.fetchone()
        if not row2:
            return None
        out = self._row_segment(row2)
        try:
            ep = self.get_episode(episode_id)
            lang = ep.transcript_language if ep else None
            all_segs = self.list_transcript_segments(episode_id, include_deleted=True)
            self._persist_transcript_json(episode_id, all_segs, lang)
        except Exception:
            log.warning(
                "patch_transcript_segment_text: failed persist transcript.json episode_id=%s",
                episode_id,
            )
        self.build_speaker_groups(episode_id)
        return out

    def list_transcript_segments(self, episode_id: str, *, include_deleted: bool = False) -> list[TranscriptSegmentRecord]:
        with self._lock:
            cached = self._load_segments_db(episode_id, include_deleted=include_deleted)
        if cached:
            return cached
        self.hydrate_transcript_from_disk(episode_id)
        with self._lock:
            return self._load_segments_db(episode_id, include_deleted=include_deleted)

    def build_speaker_groups(self, episode_id: str) -> list[SpeakerGroupRecord]:
        segs = self.list_transcript_segments(episode_id)
        buckets: dict[str, list[TranscriptSegmentRecord]] = {}
        for seg in segs:
            lbl = seg.speaker_label or "UNKNOWN"
            buckets.setdefault(lbl, []).append(seg)
        groups: list[SpeakerGroupRecord] = []
        for label, items in sorted(buckets.items()):
            total_dur = sum(s.end_time - s.start_time for s in items)
            samples = [s.text for s in items[:3]]
            groups.append(
                SpeakerGroupRecord(
                    speaker_label=label,
                    episode_id=episode_id,
                    display_name=label,
                    segment_count=len(items),
                    total_speaking_duration=round(total_dur, 2),
                    sample_texts=samples,
                )
            )
        with self._lock:
            self._cx.execute("DELETE FROM speaker_groups WHERE episode_id = ?", (episode_id,))
            for g in groups:
                self._cx.execute(
                    """INSERT INTO speaker_groups (
                      episode_id, speaker_label, display_name, segment_count,
                      total_speaking_duration, sample_texts_json, is_narrator
                    ) VALUES (?,?,?,?,?,?,?)""",
                    (
                        g.episode_id,
                        g.speaker_label,
                        g.display_name,
                        g.segment_count,
                        g.total_speaking_duration,
                        _j(g.sample_texts),
                        1 if g.is_narrator else 0,
                    ),
                )
            self._cx.commit()
        return groups

    def list_speaker_groups(self, episode_id: str) -> list[SpeakerGroupRecord]:
        with self._lock:
            cur = self._cx.execute(
                """SELECT * FROM speaker_groups WHERE episode_id = ?
                   ORDER BY speaker_label""",
                (episode_id,),
            )
            rows = cur.fetchall()
        if rows:
            return [self._row_speaker_group(r) for r in rows]
        return self.build_speaker_groups(episode_id)

    def rename_speaker_group(
        self,
        episode_id: str,
        speaker_label: str,
        display_name: str | None = None,
        is_narrator: bool | None = None,
    ) -> SpeakerGroupRecord | None:
        groups = self.list_speaker_groups(episode_id)
        target: SpeakerGroupRecord | None = None
        for g in groups:
            if g.speaker_label == speaker_label:
                target = g
                break
        if not target:
            return None
        if display_name is not None:
            target.display_name = display_name
        if is_narrator is not None:
            target.is_narrator = is_narrator
        with self._lock:
            self._cx.execute(
                """UPDATE speaker_groups SET display_name = ?, is_narrator = ?
                   WHERE episode_id = ? AND speaker_label = ?""",
                (
                    target.display_name,
                    1 if target.is_narrator else 0,
                    episode_id,
                    speaker_label,
                ),
            )
            self._cx.commit()
        return target

    def merge_speaker_labels(self, episode_id: str, from_label: str, into_label: str) -> bool:
        """Reassign all transcript segments from from_label to into_label, then rebuild groups."""
        fl = from_label.strip()
        tl = into_label.strip()
        if not fl or not tl or fl == tl:
            return False
        groups = self.list_speaker_groups(episode_id)
        from_g = next((g for g in groups if g.speaker_label == fl), None)
        to_g = next((g for g in groups if g.speaker_label == tl), None)
        if not from_g or not to_g:
            return False
        segs = self.list_transcript_segments(episode_id)
        new_segs: list[TranscriptSegmentRecord] = []
        for s in segs:
            lab = (s.speaker_label or "UNKNOWN").strip()
            if lab == fl:
                lab = tl
            new_segs.append(
                TranscriptSegmentRecord(
                    segment_id=s.segment_id,
                    episode_id=s.episode_id,
                    start_time=s.start_time,
                    end_time=s.end_time,
                    text=s.text,
                    speaker_label=lab,
                    text_original=s.text_original,
                    text_translation_en=s.text_translation_en,
                )
            )
        ep = self.get_episode(episode_id)
        lang = ep.transcript_language if ep else None
        self.set_transcript_for_episode(episode_id, new_segs, language=lang)
        self.build_speaker_groups(episode_id)
        merged_narrator = from_g.is_narrator or to_g.is_narrator
        display = to_g.display_name
        if to_g.display_name == tl and from_g.display_name != fl:
            display = from_g.display_name
        self.rename_speaker_group(
            episode_id,
            tl,
            display_name=display,
            is_narrator=merged_narrator,
        )
        return True

    def locate_episode_upload_dir(self, episode_id: str) -> tuple[str, Path] | None:
        if not UPLOADS_ROOT.is_dir():
            log.debug("locate skip: UPLOADS_ROOT not a directory (%s)", UPLOADS_ROOT)
            return None
        for proj_dir in sorted(UPLOADS_ROOT.iterdir()):
            if not proj_dir.is_dir():
                continue
            ep_dir = proj_dir / episode_id
            if _episode_upload_dir_has_media(ep_dir):
                return (proj_dir.name, ep_dir)
        log.debug("locate miss episode_id=%s under %s", episode_id, UPLOADS_ROOT)
        return None

    def _count_segments(self, episode_id: str) -> int:
        cur = self._cx.execute(
            "SELECT COUNT(*) AS c FROM transcript_segments WHERE episode_id = ?",
            (episode_id,),
        )
        row = cur.fetchone()
        return int(row["c"]) if row else 0

    def ensure_episode_from_upload_dir(self, episode_id: str) -> EpisodeRecord | None:
        with self._lock:
            existing = self.get_episode(episode_id)
            if existing:
                log.debug("ensure episode_id=%s: already in store", episode_id)
                return existing
        found = self.locate_episode_upload_dir(episode_id)
        if not found:
            log.warning(
                "ensure episode_id=%s: no upload folder found under %s",
                episode_id,
                UPLOADS_ROOT,
            )
            return None
        project_id, ep_dir = found
        has_audio = (ep_dir / "audio.wav").is_file()
        with self._lock:
            if self.get_episode(episode_id):
                return self.get_episode(episode_id)
            n = self._count_segments(episode_id)
            rec = EpisodeRecord(
                id=episode_id,
                project_id=project_id,
                title="Uploaded episode (recovered)",
                status="ready" if has_audio else "processing",
                segment_count=n,
                updated_at=_now_iso(),
            )
            self._cx.execute(
                """INSERT INTO episodes (
                  id, project_id, title, status, segment_count, updated_at,
                  source_video_rel, extracted_audio_rel, thumbnail_rels_json,
                  duration_sec, transcript_language
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rec.id,
                    rec.project_id,
                    rec.title,
                    rec.status,
                    rec.segment_count,
                    rec.updated_at,
                    None,
                    None,
                    _j([]),
                    None,
                    None,
                ),
            )
            self._cx.commit()
        log.info(
            "ensure episode_id=%s: recovered from disk project_id=%s path=%s",
            episode_id,
            project_id,
            ep_dir,
        )
        self.hydrate_transcript_from_disk(episode_id)
        with self._lock:
            cur = self._cx.execute("SELECT * FROM episodes WHERE id = ?", (episode_id,))
            row = cur.fetchone()
        return self._row_episode(row) if row else None

    def hydrate_transcript_from_disk(self, episode_id: str) -> None:
        found = self.locate_episode_upload_dir(episode_id)
        if not found:
            return
        _project_id, ep_dir = found
        path = ep_dir / "transcript.json"
        if not path.is_file():
            return
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        rows: list[TranscriptSegmentRecord] = []
        for item in raw.get("segments", []):
            try:
                rows.append(
                    TranscriptSegmentRecord(
                        segment_id=str(item["segment_id"]),
                        episode_id=str(item.get("episode_id") or episode_id),
                        start_time=float(item["start_time"]),
                        end_time=float(item["end_time"]),
                        text=str(item["text"]),
                        speaker_label=item.get("speaker_label"),
                        text_original=item.get("text_original"),
                        text_translation_en=item.get("text_translation_en"),
                        deleted=int(item.get("deleted", 0) or 0),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        language = raw.get("language")
        if isinstance(language, str):
            lang: str | None = language
        else:
            lang = None
        with self._lock:
            self._replace_transcript_segments(episode_id, rows)
            ep = self.get_episode(episode_id)
            if ep:
                ts = _now_iso()
                if lang:
                    self._cx.execute(
                        """UPDATE episodes SET segment_count = ?, transcript_language = ?, updated_at = ?
                           WHERE id = ?""",
                        (len(rows), lang, ts, episode_id),
                    )
                else:
                    self._cx.execute(
                        """UPDATE episodes SET segment_count = ?, updated_at = ? WHERE id = ?""",
                        (len(rows), ts, episode_id),
                    )
            self._cx.commit()
        log.info(
            "hydrate transcript from disk episode_id=%s segments=%s",
            episode_id,
            len(rows),
        )
        if rows:
            self.build_speaker_groups(episode_id)

    def _persist_transcript_json(
        self,
        episode_id: str,
        segments: list[TranscriptSegmentRecord],
        language: str | None,
    ) -> None:
        found = self.locate_episode_upload_dir(episode_id)
        if not found:
            return
        _project_id, ep_dir = found
        path = ep_dir / "transcript.json"
        payload = {
            "episode_id": episode_id,
            "language": language,
            "segments": [
                {
                    "segment_id": s.segment_id,
                    "episode_id": s.episode_id,
                    "start_time": s.start_time,
                    "end_time": s.end_time,
                    "text": s.text,
                    "speaker_label": s.speaker_label,
                    "text_original": s.text_original,
                    "text_translation_en": s.text_translation_en,
                    "deleted": int(getattr(s, "deleted", 0) or 0),
                }
                for s in segments
            ],
        }
        try:
            path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError:
            pass

    def create_job(
        self,
        job_type: str,
        message: str,
        result: dict[str, Any] | None = None,
        episode_id: str | None = None,
    ) -> JobRecord:
        jid = f"job_{uuid.uuid4().hex[:10]}"
        ts = _now_iso()
        job = JobRecord(
            id=jid,
            type=job_type,
            status="queued",
            progress=0.0,
            message=message,
            poll_count=0,
            result=result,
            episode_id=episode_id,
            created_at=ts,
            updated_at=ts,
        )
        with self._lock:
            self._cx.execute(
                """INSERT INTO jobs (
                  id, type, status, progress, message, poll_count, result_json, episode_id,
                  created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    job.id,
                    job.type,
                    job.status,
                    job.progress,
                    job.message,
                    job.poll_count,
                    _j(job.result) if job.result is not None else None,
                    job.episode_id,
                    job.created_at,
                    job.updated_at,
                ),
            )
            self._cx.commit()
        return job

    def update_job(self, job_id: str, **fields: Any) -> JobRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
            r = cur.fetchone()
            if not r:
                return None
            job = self._row_job(r)
            for key, val in fields.items():
                if key == "result":
                    job.result = val  # type: ignore[assignment]
                elif hasattr(job, key):
                    setattr(job, key, val)
            job.updated_at = _now_iso()
            self._cx.execute(
                """UPDATE jobs SET type=?, status=?, progress=?, message=?, poll_count=?,
                   result_json=?, episode_id=?, updated_at=? WHERE id=?""",
                (
                    job.type,
                    job.status,
                    job.progress,
                    job.message,
                    job.poll_count,
                    _j(job.result) if job.result is not None else None,
                    job.episode_id,
                    job.updated_at,
                    job.id,
                ),
            )
            self._cx.commit()
        return job

    def update_episode(self, episode_id: str, **fields: Any) -> EpisodeRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM episodes WHERE id = ?", (episode_id,))
            r = cur.fetchone()
            if not r:
                return None
            ep = self._row_episode(r)
            for key, val in fields.items():
                if hasattr(ep, key):
                    setattr(ep, key, val)
            ep.updated_at = _now_iso()
            self._cx.execute(
                """UPDATE episodes SET
                  project_id=?, title=?, status=?, segment_count=?, updated_at=?,
                  source_video_rel=?, extracted_audio_rel=?, thumbnail_rels_json=?,
                  duration_sec=?, transcript_language=?, media_type=?
                  WHERE id=?""",
                (
                    ep.project_id,
                    ep.title,
                    ep.status,
                    ep.segment_count,
                    ep.updated_at,
                    ep.source_video_rel,
                    ep.extracted_audio_rel,
                    _j(ep.thumbnail_rels),
                    ep.duration_sec,
                    ep.transcript_language,
                    ep.media_type,
                    episode_id,
                ),
            )
            self._cx.commit()
        return ep

    def peek_job(self, job_id: str) -> JobRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
            r = cur.fetchone()
        return self._row_job(r) if r else None

    def create_episode(
        self,
        project_id: str,
        title: str,
        status: str = "processing",
        media_type: str = "video",
    ) -> EpisodeRecord:
        eid = f"ep-{uuid.uuid4().hex[:10]}"
        ts = _now_iso()
        rec = EpisodeRecord(
            id=eid,
            project_id=project_id,
            title=title,
            status=status,
            segment_count=0,
            updated_at=ts,
            media_type=media_type,
        )
        with self._lock:
            self._cx.execute(
                """INSERT INTO episodes (
                  id, project_id, title, status, segment_count, updated_at,
                  source_video_rel, extracted_audio_rel, thumbnail_rels_json, duration_sec,
                  transcript_language, media_type
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rec.id,
                    rec.project_id,
                    rec.title,
                    rec.status,
                    rec.segment_count,
                    rec.updated_at,
                    None,
                    None,
                    _j([]),
                    None,
                    None,
                    rec.media_type,
                ),
            )
            self._cx.commit()
        return rec

    def touch_job_progress(self, job_id: str) -> JobRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
            r = cur.fetchone()
            if not r:
                return None
            job = self._row_job(r)
            if job.type not in STUB_POLL_ADVANCE_TYPES:
                return job
            job.poll_count += 1
            job.updated_at = _now_iso()

            if job.status == "queued":
                job.status = "running"
                job.progress = 0.35
                job.message = "Processing…"
            elif job.status == "running":
                job.status = "done"
                job.progress = 1.0
                job.message = "Complete"
                if job.type == "voice_preview" and job.result is None:
                    job.result = {"preview_id": "pv_stub", "duration_ms": 4200}
                elif job.type == "character_generate" and job.result is None:
                    job.result = {"asset_ids": ["ast_stub_1", "ast_stub_2"]}
                elif job.type == "segment_replace" and job.result is None:
                    job.result = {"segment_id": "seg_stub", "replaced": True}
                elif job.type == "episode_export" and job.result is None:
                    job.result = {
                        "download_url": "https://example.com/exports/stub.zip",
                        "format": "ProRes 422 HQ",
                    }

            self._cx.execute(
                """UPDATE jobs SET status=?, progress=?, message=?, poll_count=?,
                   result_json=?, updated_at=? WHERE id=?""",
                (
                    job.status,
                    job.progress,
                    job.message,
                    job.poll_count,
                    _j(job.result) if job.result is not None else None,
                    job.updated_at,
                    job.id,
                ),
            )
            self._cx.commit()
        return job

    # ── user_voices CRUD ──────────────────────────────────────────────

    def create_user_voice(
        self,
        *,
        voice_id: str,
        name: str,
        elevenlabs_voice_id: str | None,
        source_type: str,
        sample_audio_path: str | None,
        rights_type: str,
        rights_note: str = "",
        preview_audio_path: str | None = None,
        user_id: str | None = None,
    ) -> UserVoiceRecord:
        ts = _now_iso()
        rec = UserVoiceRecord(
            id=voice_id,
            name=name,
            elevenlabs_voice_id=elevenlabs_voice_id,
            source_type=source_type,
            sample_audio_path=sample_audio_path,
            rights_type=rights_type,
            rights_note=rights_note,
            preview_audio_path=preview_audio_path,
            created_at=ts,
            user_id=user_id,
        )
        with self._lock:
            self._cx.execute(
                """INSERT INTO user_voices
                  (id, name, elevenlabs_voice_id, source_type, sample_audio_path,
                   rights_type, rights_note, preview_audio_path, created_at, user_id)
                VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    rec.id, rec.name, rec.elevenlabs_voice_id, rec.source_type,
                    rec.sample_audio_path, rec.rights_type, rec.rights_note,
                    rec.preview_audio_path, rec.created_at, rec.user_id,
                ),
            )
            self._cx.commit()
        return rec

    def list_user_voices(self, *, user_id: str | None = None) -> list[UserVoiceRecord]:
        with self._lock:
            if user_id:
                cur = self._cx.execute(
                    "SELECT * FROM user_voices WHERE user_id = ? ORDER BY created_at DESC",
                    (user_id,),
                )
            else:
                cur = self._cx.execute(
                    "SELECT * FROM user_voices ORDER BY created_at DESC",
                )
            rows = cur.fetchall()
        return [self._row_user_voice(r) for r in rows]

    def get_user_voice(self, voice_id: str) -> UserVoiceRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM user_voices WHERE id = ?", (voice_id,))
            r = cur.fetchone()
        return self._row_user_voice(r) if r else None

    def delete_user_voice(self, voice_id: str) -> UserVoiceRecord | None:
        with self._lock:
            cur = self._cx.execute("SELECT * FROM user_voices WHERE id = ?", (voice_id,))
            r = cur.fetchone()
            if not r:
                return None
            rec = self._row_user_voice(r)
            self._cx.execute("DELETE FROM user_voices WHERE id = ?", (voice_id,))
            self._cx.commit()
        return rec

    def _row_user_voice(self, r: sqlite3.Row) -> UserVoiceRecord:
        uid = None
        try:
            uid = r["user_id"]
        except (KeyError, IndexError):
            pass
        return UserVoiceRecord(
            id=r["id"],
            name=r["name"],
            elevenlabs_voice_id=r["elevenlabs_voice_id"],
            source_type=r["source_type"],
            sample_audio_path=r["sample_audio_path"],
            rights_type=r["rights_type"],
            rights_note=r["rights_note"] or "",
            preview_audio_path=r["preview_audio_path"],
            created_at=r["created_at"],
            user_id=uid,
        )

    # ── ownership verification ─────────────────────────────────────────

    def project_owner_id(self, project_id: str) -> str | None:
        with self._lock:
            cur = self._cx.execute("SELECT user_id FROM projects WHERE id = ?", (project_id,))
            r = cur.fetchone()
        return (r["user_id"] if r else None)

    def episode_owner_id(self, episode_id: str) -> str | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT p.user_id FROM episodes e JOIN projects p ON p.id = e.project_id WHERE e.id = ?",
                (episode_id,),
            )
            r = cur.fetchone()
        return (r["user_id"] if r else None)

    def character_owner_id(self, character_id: str) -> str | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT p.user_id FROM characters c JOIN projects p ON p.id = c.project_id WHERE c.id = ?",
                (character_id,),
            )
            r = cur.fetchone()
        return (r["user_id"] if r else None)

    def clip_owner_id(self, clip_id: str) -> str | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT p.user_id FROM voice_clips vc JOIN projects p ON p.id = vc.project_id WHERE vc.id = ?",
                (clip_id,),
            )
            r = cur.fetchone()
        return (r["user_id"] if r else None)

    def user_voice_owner_id(self, voice_id: str) -> str | None:
        with self._lock:
            cur = self._cx.execute("SELECT user_id FROM user_voices WHERE id = ?", (voice_id,))
            r = cur.fetchone()
        return (r["user_id"] if r else None)

    def job_owner_id(self, job_id: str) -> str | None:
        with self._lock:
            cur = self._cx.execute(
                """SELECT p.user_id FROM jobs j
                   JOIN episodes e ON e.id = j.episode_id
                   JOIN projects p ON p.id = e.project_id
                   WHERE j.id = ?""",
                (job_id,),
            )
            r = cur.fetchone()
        return (r["user_id"] if r else None)

    # ── multi-take helpers ────────────────────────────────────────────

    def deactivate_takes_for_segment(
        self, episode_id: str, segment_id: str, character_id: str,
    ) -> None:
        with self._lock:
            self._cx.execute(
                """UPDATE replacements SET is_active_take = 0
                   WHERE episode_id = ? AND segment_id = ? AND character_id = ?""",
                (episode_id, segment_id, character_id),
            )
            self._cx.commit()

    def set_active_take(self, episode_id: str, replacement_id: str) -> ReplacementRecord | None:
        with self._lock:
            cur = self._cx.execute(
                "SELECT * FROM replacements WHERE replacement_id = ? AND episode_id = ?",
                (replacement_id, episode_id),
            )
            r = cur.fetchone()
            if not r:
                return None
            rec = self._row_replacement(r)
            self._cx.execute(
                """UPDATE replacements SET is_active_take = 0
                   WHERE episode_id = ? AND segment_id = ? AND character_id = ?""",
                (rec.episode_id, rec.segment_id, rec.character_id),
            )
            self._cx.execute(
                "UPDATE replacements SET is_active_take = 1 WHERE replacement_id = ?",
                (replacement_id,),
            )
            self._cx.commit()
            rec.is_active_take = 1
        return rec

    def next_take_number(self, episode_id: str, segment_id: str, character_id: str) -> int:
        with self._lock:
            cur = self._cx.execute(
                """SELECT COALESCE(MAX(take_number), 0) FROM replacements
                   WHERE episode_id = ? AND segment_id = ? AND character_id = ?""",
                (episode_id, segment_id, character_id),
            )
            r = cur.fetchone()
        return (int(r[0]) if r else 0) + 1
