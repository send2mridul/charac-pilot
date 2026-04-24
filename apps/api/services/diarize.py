"""Lightweight speaker diarization using MFCC embeddings + agglomerative clustering.

No external model downloads, no tokens — uses librosa + sklearn locally.
"""

from __future__ import annotations

import logging
from pathlib import Path

from db.store import TranscriptSegmentRecord

logger = logging.getLogger("characpilot.diarize")

_MAX_SPEAKERS = 10
_DEFAULT_SPEAKERS = 2


def _load_libs():
    try:
        import librosa
        import numpy as np
        from sklearn.cluster import AgglomerativeClustering
    except ImportError as e:
        raise RuntimeError(
            "Diarization requires librosa, scikit-learn, and soundfile. "
            "Run: pip install librosa scikit-learn soundfile"
        ) from e
    return librosa, np, AgglomerativeClustering


def _extract_segment_embedding(
    wav_path: Path, start: float, end: float, librosa, np,
) -> "np.ndarray | None":
    dur = end - start
    if dur < 0.1:
        return None
    try:
        chunk, sr = librosa.load(str(wav_path), sr=16000, mono=True, offset=start, duration=dur)
    except Exception:
        return None
    if len(chunk) < int(0.1 * sr):
        return None
    try:
        mfcc = librosa.feature.mfcc(y=chunk, sr=sr, n_mfcc=20)
        return np.mean(mfcc, axis=1)
    except Exception:
        return None


def assign_speaker_labels(
    wav_path: Path,
    segments: list[TranscriptSegmentRecord],
    num_speakers: int | None = None,
) -> list[TranscriptSegmentRecord]:
    """Assign SPEAKER_00..N labels to transcript segments via MFCC clustering.

    Falls back to UNKNOWN if diarization fails or if there are too few segments.
    """
    if not segments:
        return segments

    if len(segments) < 2:
        for seg in segments:
            seg.speaker_label = "SPEAKER_00"
        return segments

    try:
        librosa, np, AgglomerativeClustering = _load_libs()
    except RuntimeError as e:
        logger.warning("diarize fallback: %s", e)
        for seg in segments:
            seg.speaker_label = "UNKNOWN"
        return segments

    if not wav_path.is_file():
        logger.warning("diarize: WAV not found %s, using UNKNOWN", wav_path)
        for seg in segments:
            seg.speaker_label = "UNKNOWN"
        return segments

    embeddings = []
    valid_indices: list[int] = []
    for i, seg in enumerate(segments):
        emb = _extract_segment_embedding(wav_path, seg.start_time, seg.end_time, librosa, np)
        if emb is not None:
            embeddings.append(emb)
            valid_indices.append(i)

    if len(embeddings) < 2:
        for seg in segments:
            seg.speaker_label = "SPEAKER_00"
        return segments

    X = np.array(embeddings)

    n_clusters = num_speakers or _DEFAULT_SPEAKERS
    n_clusters = max(2, min(n_clusters, _MAX_SPEAKERS, len(embeddings)))

    try:
        clustering = AgglomerativeClustering(n_clusters=n_clusters)
        labels = clustering.fit_predict(X)
    except Exception as e:
        logger.warning("diarize: clustering failed: %s", e)
        for seg in segments:
            seg.speaker_label = "UNKNOWN"
        return segments

    label_map: dict[int, str] = {}
    for cluster_id in sorted(set(labels)):
        label_map[cluster_id] = f"SPEAKER_{cluster_id:02d}"

    for idx, cluster_label in zip(valid_indices, labels):
        segments[idx].speaker_label = label_map[int(cluster_label)]

    for seg in segments:
        if seg.speaker_label is None:
            seg.speaker_label = "UNKNOWN"

    speaker_counts = {}
    for seg in segments:
        lbl = seg.speaker_label or "UNKNOWN"
        speaker_counts[lbl] = speaker_counts.get(lbl, 0) + 1
    logger.info(
        "diarize done: %d segments, %d clusters, distribution=%s",
        len(segments),
        len(label_map),
        speaker_counts,
    )
    return segments
