"""Delivery presets mapped to real ElevenLabs voice_settings values.

Lower stability = more expressive variation.
Higher style = more stylistic exaggeration.
These are honest suggestions, not guarantees.
"""

from __future__ import annotations

DELIVERY_PRESETS: dict[str, dict[str, float]] = {
    "neutral":  {"stability": 0.50, "similarity_boost": 0.75, "style": 0.0},
    "warm":     {"stability": 0.55, "similarity_boost": 0.80, "style": 0.15},
    "calm":     {"stability": 0.70, "similarity_boost": 0.75, "style": 0.05},
    "sad":      {"stability": 0.40, "similarity_boost": 0.70, "style": 0.35},
    "angry":    {"stability": 0.30, "similarity_boost": 0.65, "style": 0.55},
    "excited":  {"stability": 0.25, "similarity_boost": 0.70, "style": 0.45},
    "whisper":  {"stability": 0.80, "similarity_boost": 0.85, "style": 0.05},
    "playful":  {"stability": 0.35, "similarity_boost": 0.70, "style": 0.30},
    "dramatic": {"stability": 0.20, "similarity_boost": 0.60, "style": 0.70},
}

PRESET_NAMES = list(DELIVERY_PRESETS.keys())


def voice_settings_for_preset(preset: str | None) -> dict[str, float]:
    """Return voice_settings dict for a preset name, defaulting to neutral."""
    return dict(DELIVERY_PRESETS.get(preset or "neutral", DELIVERY_PRESETS["neutral"]))
