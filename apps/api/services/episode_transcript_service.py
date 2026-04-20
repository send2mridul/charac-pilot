from __future__ import annotations

from db.store import TranscriptSegmentRecord, store
from schemas.transcript import TranscriptOut, TranscriptSegmentOut


def _to_segment_out(r: TranscriptSegmentRecord) -> TranscriptSegmentOut:
    return TranscriptSegmentOut(
        segment_id=r.segment_id,
        episode_id=r.episode_id,
        start_time=r.start_time,
        end_time=r.end_time,
        text=r.text,
        speaker_label=r.speaker_label,
    )


def list_segments(episode_id: str) -> list[TranscriptSegmentOut]:
    return [_to_segment_out(r) for r in store.list_transcript_segments(episode_id)]


def get_transcript(episode_id: str) -> TranscriptOut:
    ep = store.get_episode(episode_id)
    lang = ep.transcript_language if ep else None
    segs = list_segments(episode_id)
    return TranscriptOut(episode_id=episode_id, language=lang, segments=segs)
