"""In-memory persistence (dev / stub only)."""

from __future__ import annotations

import json
import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from storage_paths import UPLOADS_ROOT

log = logging.getLogger("characpilot.store")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _episode_upload_dir_has_media(ep_dir: Path) -> bool:
    """True if this episode folder looks like a real upload (source video, audio, thumbs, or transcript)."""
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


@dataclass
class ProjectRecord:
    id: str
    name: str
    status: str
    scene_count: int
    lead: str
    updated_at: str


@dataclass
class EpisodeRecord:
    id: str
    project_id: str
    title: str
    status: str
    segment_count: int
    updated_at: str
    source_video_rel: str | None = None
    extracted_audio_rel: str | None = None
    thumbnail_rels: list[str] = field(default_factory=list)
    duration_sec: float | None = None
    transcript_language: str | None = None


@dataclass
class TranscriptSegmentRecord:
    segment_id: str
    episode_id: str
    start_time: float
    end_time: float
    text: str
    speaker_label: str | None


@dataclass
class SpeakerGroupRecord:
    speaker_label: str
    episode_id: str
    display_name: str
    segment_count: int
    total_speaking_duration: float
    sample_texts: list[str]
    is_narrator: bool = False


@dataclass
class CharacterRecord:
    id: str
    project_id: str
    name: str
    role: str
    traits: list[str]
    wardrobe_notes: str
    continuity_rules: list[str]


@dataclass
class JobRecord:
    id: str
    type: str
    status: str
    progress: float
    message: str
    poll_count: int = 0
    result: dict[str, Any] | None = None
    episode_id: str | None = None
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)


# Jobs that advance queued → running → done when GET /jobs/{id} is polled (stub workers).
STUB_POLL_ADVANCE_TYPES = frozenset(
    {"voice_preview", "character_generate", "segment_replace", "episode_export"},
)


class InMemoryStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._seed()

    def _seed(self) -> None:
        self.projects: dict[str, ProjectRecord] = {
            "p1": ProjectRecord(
                id="p1",
                name="Neon Alley",
                status="active",
                scene_count=38,
                lead="You",
                updated_at="2026-04-19T12:00:00+00:00",
            ),
            "p2": ProjectRecord(
                id="p2",
                name="Glass Garden",
                status="active",
                scene_count=22,
                lead="Studio North",
                updated_at="2026-04-17T09:30:00+00:00",
            ),
            "p3": ProjectRecord(
                id="p3",
                name="Midnight Courier",
                status="archived",
                scene_count=54,
                lead="You",
                updated_at="2026-04-12T16:45:00+00:00",
            ),
        }
        self.episodes: dict[str, EpisodeRecord] = {}
        self.characters: dict[str, CharacterRecord] = {}
        self.jobs: dict[str, JobRecord] = {}
        self.transcript_segments: dict[str, list[TranscriptSegmentRecord]] = {}
        self.speaker_groups: dict[str, list[SpeakerGroupRecord]] = {}

        self._seed_episodes()
        self._seed_characters()

    def _seed_episodes(self) -> None:
        ep_data = [
            ("ep1", "p1", "101 — Cold open", "draft", 6),
            ("ep2", "p1", "102 — Alley chase", "review", 9),
            ("ep3", "p2", "201 — Greenhouse", "draft", 5),
        ]
        for eid, pid, title, status, segs in ep_data:
            self.episodes[eid] = EpisodeRecord(
                id=eid,
                project_id=pid,
                title=title,
                status=status,
                segment_count=segs,
                updated_at=_now_iso(),
            )

    def _seed_characters(self) -> None:
        self.characters["c1"] = CharacterRecord(
            id="c1",
            project_id="p1",
            name="Mara Voss",
            role="Lead",
            traits=["calm cadence", "dry humor", "left-handed"],
            wardrobe_notes="Charcoal trench, copper pins, no logos on camera.",
            continuity_rules=[
                "Hair part always camera right after scene 4",
                "Scar visible in profile only",
            ],
        )
        self.characters["c2"] = CharacterRecord(
            id="c2",
            project_id="p1",
            name="Ellis Kade",
            role="Supporting",
            traits=["fast talker", "nervous tell: adjusts cuff"],
            wardrobe_notes="Navy suit, knit tie, pocket square folded flat.",
            continuity_rules=[
                "Ring on index finger only in flashbacks",
                "Glasses anti-glare coating",
            ],
        )
        self.characters["c3"] = CharacterRecord(
            id="c3",
            project_id="p2",
            name="Sora Minh",
            role="Lead",
            traits=["precise", "botanist jargon"],
            wardrobe_notes="Linen lab coat, hair tied low.",
            continuity_rules=["No watch in greenhouse scenes"],
        )

    def list_projects(self) -> list[ProjectRecord]:
        with self._lock:
            return sorted(self.projects.values(), key=lambda p: p.updated_at, reverse=True)

    def get_project(self, project_id: str) -> ProjectRecord | None:
        with self._lock:
            return self.projects.get(project_id)

    def create_project(self, name: str, lead: str) -> ProjectRecord:
        with self._lock:
            pid = f"p-{uuid.uuid4().hex[:8]}"
            rec = ProjectRecord(
                id=pid,
                name=name,
                status="active",
                scene_count=0,
                lead=lead,
                updated_at=_now_iso(),
            )
            self.projects[pid] = rec
            return rec

    def list_episodes(self, project_id: str) -> list[EpisodeRecord]:
        with self._lock:
            return sorted(
                [e for e in self.episodes.values() if e.project_id == project_id],
                key=lambda e: e.title,
            )

    def list_characters(self, project_id: str) -> list[CharacterRecord]:
        with self._lock:
            return sorted(
                [c for c in self.characters.values() if c.project_id == project_id],
                key=lambda c: c.name,
            )

    def get_character(self, character_id: str) -> CharacterRecord | None:
        with self._lock:
            return self.characters.get(character_id)

    def get_episode(self, episode_id: str) -> EpisodeRecord | None:
        with self._lock:
            return self.episodes.get(episode_id)

    def set_transcript_for_episode(
        self,
        episode_id: str,
        segments: list[TranscriptSegmentRecord],
        language: str | None = None,
    ) -> None:
        had_ep_row = False
        with self._lock:
            self.transcript_segments[episode_id] = list(segments)
            ep = self.episodes.get(episode_id)
            if ep:
                had_ep_row = True
                ep.segment_count = len(segments)
                if language:
                    ep.transcript_language = language
                ep.updated_at = _now_iso()
        log.info(
            "transcript saved episode_id=%s segments=%s language=%s episode_row=%s",
            episode_id,
            len(segments),
            language,
            had_ep_row,
        )
        self._persist_transcript_json(episode_id, segments, language)

    def list_transcript_segments(
        self,
        episode_id: str,
    ) -> list[TranscriptSegmentRecord]:
        with self._lock:
            cached = list(self.transcript_segments.get(episode_id, []))
        if cached:
            return cached
        self.hydrate_transcript_from_disk(episode_id)
        with self._lock:
            return list(self.transcript_segments.get(episode_id, []))

    def build_speaker_groups(self, episode_id: str) -> list[SpeakerGroupRecord]:
        """Build draft speaker groups from current transcript segments."""
        segs = self.list_transcript_segments(episode_id)
        buckets: dict[str, list[TranscriptSegmentRecord]] = {}
        for seg in segs:
            lbl = seg.speaker_label or "UNKNOWN"
            buckets.setdefault(lbl, []).append(seg)
        groups: list[SpeakerGroupRecord] = []
        for label, items in sorted(buckets.items()):
            total_dur = sum(s.end_time - s.start_time for s in items)
            samples = [s.text for s in items[:3]]
            groups.append(SpeakerGroupRecord(
                speaker_label=label,
                episode_id=episode_id,
                display_name=label,
                segment_count=len(items),
                total_speaking_duration=round(total_dur, 2),
                sample_texts=samples,
            ))
        with self._lock:
            self.speaker_groups[episode_id] = groups
        return groups

    def list_speaker_groups(self, episode_id: str) -> list[SpeakerGroupRecord]:
        with self._lock:
            cached = list(self.speaker_groups.get(episode_id, []))
        if cached:
            return cached
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
        with self._lock:
            if display_name is not None:
                target.display_name = display_name
            if is_narrator is not None:
                target.is_narrator = is_narrator
        return target

    def locate_episode_upload_dir(self, episode_id: str) -> tuple[str, Path] | None:
        """Return (project_id, episode_dir) if uploads/<project>/<episode_id> has recognizable media."""
        if not UPLOADS_ROOT.is_dir():
            log.debug("locate skip: UPLOADS_ROOT not a directory (%s)", UPLOADS_ROOT)
            return None
        for proj_dir in sorted(UPLOADS_ROOT.iterdir()):
            if not proj_dir.is_dir():
                continue
            ep_dir = proj_dir / episode_id
            if _episode_upload_dir_has_media(ep_dir):
                return (proj_dir.name, ep_dir)
        log.debug(
            "locate miss episode_id=%s under %s",
            episode_id,
            UPLOADS_ROOT,
        )
        return None

    def ensure_episode_from_upload_dir(self, episode_id: str) -> EpisodeRecord | None:
        """Register a minimal episode row if media exists on disk but memory was cleared (e.g. API reload)."""
        with self._lock:
            existing = self.episodes.get(episode_id)
            if existing:
                log.debug("ensure episode_id=%s: already in memory", episode_id)
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
            if episode_id in self.episodes:
                return self.episodes[episode_id]
            rec = EpisodeRecord(
                id=episode_id,
                project_id=project_id,
                title="Uploaded episode (recovered)",
                status="ready" if has_audio else "processing",
                segment_count=len(self.transcript_segments.get(episode_id, [])),
                updated_at=_now_iso(),
            )
            self.episodes[episode_id] = rec
        log.info(
            "ensure episode_id=%s: recovered from disk project_id=%s path=%s",
            episode_id,
            project_id,
            ep_dir,
        )
        self.hydrate_transcript_from_disk(episode_id)
        with self._lock:
            return self.episodes.get(episode_id)

    def hydrate_transcript_from_disk(self, episode_id: str) -> None:
        """Load transcript.json from the episode upload folder into memory."""
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
            self.transcript_segments[episode_id] = rows
            ep = self.episodes.get(episode_id)
            if ep:
                ep.segment_count = len(rows)
                if lang:
                    ep.transcript_language = lang
                ep.updated_at = _now_iso()
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
        with self._lock:
            jid = f"job_{uuid.uuid4().hex[:10]}"
            job = JobRecord(
                id=jid,
                type=job_type,
                status="queued",
                progress=0.0,
                message=message,
                poll_count=0,
                result=result,
                episode_id=episode_id,
            )
            self.jobs[jid] = job
            return job

    def update_job(self, job_id: str, **fields: Any) -> JobRecord | None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            for key, val in fields.items():
                if hasattr(job, key):
                    setattr(job, key, val)
            job.updated_at = _now_iso()
            return job

    def update_episode(self, episode_id: str, **fields: Any) -> EpisodeRecord | None:
        with self._lock:
            ep = self.episodes.get(episode_id)
            if not ep:
                return None
            for key, val in fields.items():
                if hasattr(ep, key):
                    setattr(ep, key, val)
            ep.updated_at = _now_iso()
            return ep

    def peek_job(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self.jobs.get(job_id)

    def create_episode(
        self,
        project_id: str,
        title: str,
        status: str = "processing",
    ) -> EpisodeRecord:
        with self._lock:
            eid = f"ep-{uuid.uuid4().hex[:10]}"
            rec = EpisodeRecord(
                id=eid,
                project_id=project_id,
                title=title,
                status=status,
                segment_count=0,
                updated_at=_now_iso(),
            )
            self.episodes[eid] = rec
            return rec

    def touch_job_progress(self, job_id: str) -> JobRecord | None:
        """Advance stub job state on poll — simulates worker progression."""
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
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

            return job


store = InMemoryStore()
