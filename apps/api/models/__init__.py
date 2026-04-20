"""Domain constants / enums (expand when persisting to a real DB)."""

from enum import Enum


class JobType(str, Enum):
    UPLOAD_MATCH = "upload_match"
    VOICE_PREVIEW = "voice_preview"
    CHARACTER_GENERATE = "character_generate"
    SEGMENT_REPLACE = "segment_replace"
    EPISODE_EXPORT = "episode_export"
