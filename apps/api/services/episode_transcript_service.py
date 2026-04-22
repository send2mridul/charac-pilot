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
        text_original=r.text_original,
        text_translation_en=r.text_translation_en,
    )


def list_segments(episode_id: str) -> list[TranscriptSegmentOut]:
    return [_to_segment_out(r) for r in store.list_transcript_segments(episode_id)]


def get_transcript(episode_id: str) -> TranscriptOut:
    ep = store.get_episode(episode_id)
    lang = ep.transcript_language if ep else None
    segs = list_segments(episode_id)
    return TranscriptOut(episode_id=episode_id, language=lang, segments=segs)


def patch_segment_text(episode_id: str, segment_id: str, text: str) -> TranscriptSegmentOut:
    rec = store.patch_transcript_segment_text(episode_id, segment_id, text)
    if rec is None:
        raise ValueError("Segment not found")
    return _to_segment_out(rec)
