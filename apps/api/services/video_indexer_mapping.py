"""Map Azure Video Indexer index JSON into CastWeave transcript segments (found cast / detected groups)."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from db.records import TranscriptSegmentRecord
from services.transcript_text_normalize import normalize_video_indexer_language

logger = logging.getLogger(__name__)

_TIME_RE = re.compile(
    r"^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$",
)


def _parse_time_to_seconds(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        pass
    m = _TIME_RE.match(s)
    if m:
        h = int(m.group(1) or 0)
        mi = int(m.group(2))
        sec = float(m.group(3))
        return h * 3600 + mi * 60 + sec
    return None


def _instance_times(inst: dict[str, Any]) -> tuple[float | None, float | None]:
    for start_key, end_key in (
        ("start", "end"),
        ("adjustedStart", "adjustedEnd"),
        ("startTime", "endTime"),
    ):
        if start_key in inst or end_key in inst:
            st = _parse_time_to_seconds(inst.get(start_key))
            en = _parse_time_to_seconds(inst.get(end_key))
            return st, en
    return None, None


def _speaker_label_from_item(item: dict[str, Any], idx: int) -> str | None:
    sid = item.get("speakerId")
    if sid is None:
        sid = item.get("speaker_id")
    if sid is not None:
        return f"SPEAKER_VI_{sid}"
    return f"SPEAKER_VI_{idx}"


def _collect_transcript_blocks(insights: dict[str, Any]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    tr = insights.get("transcript")
    if isinstance(tr, list):
        blocks.extend([x for x in tr if isinstance(x, dict)])
    # Some payloads nest under videos[0].insights
    vids = insights.get("videos")
    if isinstance(vids, list) and vids:
        v0 = vids[0]
        if isinstance(v0, dict):
            ins = v0.get("insights")
            if isinstance(ins, dict):
                tr2 = ins.get("transcript")
                if isinstance(tr2, list):
                    blocks.extend([x for x in tr2 if isinstance(x, dict)])
    return blocks


def map_video_indexer_results_to_castweave_entities(
    index_payload: dict[str, Any],
    episode_id: str,
) -> tuple[str | None, list[TranscriptSegmentRecord]]:
    """
    Build transcript segments and optional language from Get-Video-Index style JSON.

    Does not assert real-world identity; speaker labels are stable detected-group ids.
    """
    language: str | None = None
    insights: dict[str, Any] = index_payload
    if isinstance(index_payload.get("videos"), list) and index_payload["videos"]:
        v0 = index_payload["videos"][0]
        if isinstance(v0, dict) and isinstance(v0.get("insights"), dict):
            insights = v0["insights"]
            language = (
                insights.get("sourceLanguage")
                or insights.get("language")
                or language
            )

    if language is None and isinstance(index_payload.get("sourceLanguage"), str):
        language = index_payload["sourceLanguage"]

    blocks = _collect_transcript_blocks(insights)
    if not blocks:
        blocks = _collect_transcript_blocks(index_payload)

    records: list[TranscriptSegmentRecord] = []
    for i, item in enumerate(blocks):
        text = (item.get("text") or item.get("Text") or "").strip()
        if not text:
            continue
        instances = item.get("instances")
        if not isinstance(instances, list) or not instances:
            continue
        inst0 = instances[0]
        if not isinstance(inst0, dict):
            continue
        st, en = _instance_times(inst0)
        if st is None:
            st = 0.0
        if en is None:
            en = st + 0.1
        spk = _speaker_label_from_item(item, i)
        records.append(
            TranscriptSegmentRecord(
                segment_id=f"vi-{uuid.uuid4().hex[:12]}",
                episode_id=episode_id,
                start_time=float(st),
                end_time=float(en),
                text=text,
                speaker_label=spk,
            ),
        )

    records.sort(key=lambda r: (r.start_time, r.end_time))
    logger.info(
        "Mapped Video Indexer insights to %s transcript segments (episode_id=%s)",
        len(records),
        episode_id,
    )
    return normalize_video_indexer_language(language), records
