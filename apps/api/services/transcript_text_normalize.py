"""Transcript language policy: Hindi display in casual Roman Hindi; keep Devanagari for TTS."""

from __future__ import annotations

import logging
import os
import re
import unicodedata

from db.records import TranscriptSegmentRecord

log = logging.getLogger("characpilot.normalize")

# Devanagari block (+ common joiners)
_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F\u200c\u200d]")

# Arabic script (Urdu etc. sometimes mixed in noisy ASR)
_ARABIC_SCRIPT_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+")

# Latin letters only (Roman Hindi policy for main UI)
_LATIN_LETTERS_RE = re.compile(r"[A-Za-z]")

# Keep only safe Roman + common punctuation for user-facing Hindi lines
_ROMAN_HINDI_DISPLAY_ALLOWED = re.compile(r"[^a-zA-Z0-9\s\.,;:!?\'\"()\-—…/]+")

# Obvious junk: no letters at all after strip
_PUNCT_ONLY_RE = re.compile(r"^[\s\W_]*$")

# Shown when Devanagari→Roman fails or result is unusable (English UI, ASCII only)
HINDI_PLACEHOLDER_DISPLAY = "Line unclear - edit or delete"


def lang_base(code: str | None) -> str | None:
    if not code or not str(code).strip():
        return None
    return str(code).strip().lower().split("-", 1)[0] or None


def is_hindi_language(code: str | None) -> bool:
    return lang_base(code) == "hi"


def normalize_video_indexer_language(code: str | None) -> str | None:
    """Map Video Indexer / UI labels to short codes (e.g. Hindi -> hi)."""
    if not code:
        return None
    s = str(code).strip()
    sl = s.lower()
    if sl in ("hindi", "hi-in", "hi"):
        return "hi"
    if sl in ("english", "en-us", "en-gb", "en"):
        return "en"
    if "-" in sl:
        return sl.split("-", 1)[0]
    return sl[:2] if len(sl) >= 2 else sl


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _strip_invisible_and_bom(s: str) -> str:
    s = s.replace("\ufeff", "").replace("\ufffd", "")
    # Zero-width except ZWJ/ZWNJ already handled in Devanagari runs
    return re.sub(r"[\u200b\u200e\u200f\u202a-\u202e]", "", s)


_BUILTIN_DEVANAGARI_MAP: dict[str, str] = {
    # Independent vowels
    "\u0905": "a", "\u0906": "aa", "\u0907": "i", "\u0908": "ee",
    "\u0909": "u", "\u090a": "oo", "\u090b": "ri", "\u090f": "e",
    "\u0910": "ai", "\u0913": "o", "\u0914": "au",
    # Consonants (inherent 'a')
    "\u0915": "ka", "\u0916": "kha", "\u0917": "ga", "\u0918": "gha", "\u0919": "nga",
    "\u091a": "cha", "\u091b": "chha", "\u091c": "ja", "\u091d": "jha", "\u091e": "nya",
    "\u091f": "ta", "\u0920": "tha", "\u0921": "da", "\u0922": "dha", "\u0923": "na",
    "\u0924": "ta", "\u0925": "tha", "\u0926": "da", "\u0927": "dha", "\u0928": "na",
    "\u092a": "pa", "\u092b": "pha", "\u092c": "ba", "\u092d": "bha", "\u092e": "ma",
    "\u092f": "ya", "\u0930": "ra", "\u0932": "la", "\u0935": "va",
    "\u0936": "sha", "\u0937": "sha", "\u0938": "sa", "\u0939": "ha",
    # Nukta variants
    "\u0958": "ka", "\u0959": "kha", "\u095a": "ga", "\u095b": "za",
    "\u095c": "da", "\u095d": "dha", "\u095e": "fa", "\u095f": "ya",
    # Dependent vowel signs (matras) — suppress inherent 'a' of preceding consonant
    "\u093e": "aa", "\u093f": "i", "\u0940": "ee", "\u0941": "u", "\u0942": "oo",
    "\u0947": "e", "\u0948": "ai", "\u094b": "o", "\u094c": "au", "\u0943": "ri",
    # Virama suppresses inherent 'a'
    "\u094d": "",
    # Anusvara / Chandrabindu / Visarga
    "\u0902": "n", "\u0901": "n", "\u0903": "h",
    # Common punctuation
    "\u0964": ".", "\u0965": ".",
}

_MATRA_CODEPOINTS = frozenset(
    "\u093e\u093f\u0940\u0941\u0942\u0943\u0947\u0948\u094b\u094c\u094d\u0902\u0901\u0903"
)


def _builtin_devanagari_to_roman(text: str) -> str:
    """Best-effort Devanagari to Roman Hindi without any external library."""
    out: list[str] = []
    i = 0
    chars = list(text)
    n = len(chars)
    while i < n:
        ch = chars[i]
        if ch in _BUILTIN_DEVANAGARI_MAP:
            rom = _BUILTIN_DEVANAGARI_MAP[ch]
            is_consonant = "\u0915" <= ch <= "\u0939" or "\u0958" <= ch <= "\u095f"
            if is_consonant:
                nxt = chars[i + 1] if i + 1 < n else None
                if nxt in _MATRA_CODEPOINTS:
                    rom = rom.rstrip("a")
                    rom += _BUILTIN_DEVANAGARI_MAP.get(nxt, "")
                    i += 1
                elif nxt == "\u094d":
                    rom = rom.rstrip("a")
                    i += 1
            out.append(rom)
        elif "\u0900" <= ch <= "\u097f" or ch in "\u200c\u200d":
            pass
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _devanagari_chunks_to_hk(text: str) -> str:
    """Devanagari runs -> Harvard-Kyoto ASCII (internal bridge only, not shown)."""
    try:
        from indic_transliteration import sanscript
        from indic_transliteration.sanscript import transliterate
    except ImportError:
        return _builtin_devanagari_to_roman(text)

    parts: list[str] = []
    buf: list[str] = []

    def flush() -> None:
        if not buf:
            return
        chunk = "".join(buf)
        if _DEVANAGARI_RE.search(chunk):
            try:
                chunk = transliterate(chunk, sanscript.DEVANAGARI, sanscript.HK)
            except Exception:
                chunk = _builtin_devanagari_to_roman("".join(buf))
        parts.append(chunk)
        buf.clear()

    for ch in text:
        if "\u0900" <= ch <= "\u097f" or ch in "\u200c\u200d":
            buf.append(ch)
        else:
            flush()
            parts.append(ch)
    flush()
    return "".join(parts)


def _hk_to_casual_roman_hindi(hk: str) -> str:
    """
    Turn HK-style ASCII into everyday Roman Hindi (SMS / chat style).

    HK is only an internal bridge; the result should read like normal Roman
    Hindi (lowercase, common spellings), not linguist-oriented schemes.
    """
    s = hk.strip().lower()
    if not s:
        return s
    s = re.sub(r"\s+", " ", s)

    # HK diacritics / sandhi marks that look like corruption in UI
    s = s.replace("^", "").replace("~", "")
    s = re.sub(r"\bM\b", "m", s)
    s = re.sub(r"([a-z])H\b", r"\1h", s)

    # HK nukta marker (e.g. ज़ → z2, ड़ → d2) — drop the digit, keep the letter.
    s = re.sub(r"([a-z])2", r"\1", s)
    s = re.sub(r"([a-z])3", r"\1", s)

    # Multi-word fixes first (substring replacements).
    for a, b in (
        ("kaba ae", "kab aaye"),
        ("kaba aa", "kab aa"),
        ("kaba aaye", "kab aaye"),
        ("yaha~", "yahan"),
        ("hu~", "hoon"),
    ):
        s = s.replace(a, b)

    for w, rep in (
        ("maim", "main"),
        ("tuma", "tum"),
        ("ghara", "ghar"),
        ("kaba", "kab"),
        ("bahuta", "bahut"),
        ("apa", "aap"),
        ("dera", "der"),
    ):
        s = re.sub(rf"\b{re.escape(w)}\b", rep, s)

    # यह as "this" (HK yaha); यहाँ is already mapped to yahan above.
    s = re.sub(r"\byaha\b", "yeh", s)

    s = re.sub(r"\s+", " ", s).strip()
    return s


def _transliterate_devanagari_to_casual_roman_hindi(text: str) -> str:
    """Devanagari -> casual Roman Hindi for UI (not HK/ITRANS as the visible form)."""
    hk = _devanagari_chunks_to_hk(text)
    return _hk_to_casual_roman_hindi(hk)


def _enforce_roman_hindi_display(s: str) -> str:
    """
    Main transcript policy: readable Roman (Latin) only; drop stray scripts and
    non-Latin letters. Does not add translation.
    """
    s = _strip_invisible_and_bom(s)
    s = _ARABIC_SCRIPT_RE.sub(" ", s)
    s = _DEVANAGARI_RE.sub(" ", s)
    s = _ROMAN_HINDI_DISPLAY_ALLOWED.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _hindi_display_quality_ok(display: str) -> bool:
    """True if the line has *any* readable content — placeholder only for empty results."""
    s = display.strip()
    if not s:
        return False
    if _LATIN_LETTERS_RE.search(s):
        return True
    if len(s) >= 2:
        return True
    return False


_HINDI_DIAG = os.environ.get("CASTWEAVE_HINDI_DIAG", "").strip().lower() in ("1", "true", "yes")

# Mutable counter for diagnostic logging (first N segments per process)
_diag_remaining = 30 if _HINDI_DIAG else 0


def finalize_segment_fields(
    *,
    episode_language: str | None,
    raw_text: str,
) -> tuple[str, str | None, str | None]:
    """
    Returns (text_display, text_original, text_translation_en).

    English: display = original transcript, no separate original column.
    Hindi: Devanagari -> casual Roman for display; original keeps Devanagari for TTS.
    Hindi Latin-only (romanized): normalize to safe Latin-only; original None.
    If transliteration fails or output is unusable, show ASCII placeholder; keep
    Devanagari in text_original when ASR produced it for TTS.
    """
    global _diag_remaining

    raw = _strip_invisible_and_bom((raw_text or "").strip())
    if not raw:
        return "", None, None

    lang = normalize_video_indexer_language(episode_language)

    if not is_hindi_language(lang):
        return raw, None, None

    text_original: str | None = None
    if _DEVANAGARI_RE.search(raw):
        text_original = _nfc(raw)
        display = _transliterate_devanagari_to_casual_roman_hindi(raw)
        display = _enforce_roman_hindi_display(display)
        if not _hindi_display_quality_ok(display):
            if _diag_remaining > 0:
                _diag_remaining -= 1
                log.info(
                    "hindi_diag PLACEHOLDER devanagari raw=%r display_after_enforce=%r",
                    raw[:80], display[:80],
                )
            return HINDI_PLACEHOLDER_DISPLAY, text_original, None
        if _diag_remaining > 0:
            _diag_remaining -= 1
            log.info(
                "hindi_diag OK devanagari raw=%r display=%r",
                raw[:60], display[:60],
            )
        return display, text_original, None

    display = _enforce_roman_hindi_display(raw)
    if not _hindi_display_quality_ok(display):
        if _diag_remaining > 0:
            _diag_remaining -= 1
            log.info(
                "hindi_diag PLACEHOLDER latin raw=%r display_after_enforce=%r",
                raw[:80], display[:80],
            )
        return HINDI_PLACEHOLDER_DISPLAY, None, None
    if _diag_remaining > 0:
        _diag_remaining -= 1
        log.info("hindi_diag OK latin raw=%r display=%r", raw[:60], display[:60])
    return display, None, None


def apply_transcript_language_policy(
    episode_language: str | None,
    segments: list[TranscriptSegmentRecord],
) -> list[TranscriptSegmentRecord]:
    """Normalize segment text fields for storage and API (display vs original)."""
    out: list[TranscriptSegmentRecord] = []
    for s in segments:
        disp, orig, trans_en = finalize_segment_fields(
            episode_language=episode_language,
            raw_text=s.text,
        )
        out.append(
            TranscriptSegmentRecord(
                segment_id=s.segment_id,
                episode_id=s.episode_id,
                start_time=s.start_time,
                end_time=s.end_time,
                text=disp,
                speaker_label=s.speaker_label,
                text_original=orig,
                text_translation_en=trans_en,
            ),
        )
    return out


def is_obvious_hindi_junk_line(text: str) -> bool:
    """
    Punctuation- or noise-only lines (recall: drop only when no Latin letters and
    no Devanagari letters). Conservative to avoid losing real [ha] / [hmm] in Latin.
    """
    t = _strip_invisible_and_bom((text or "").strip())
    if not t:
        return True
    if t == HINDI_PLACEHOLDER_DISPLAY:
        return False
    if _PUNCT_ONLY_RE.match(t) and not _DEVANAGARI_RE.search(t):
        return True
    if not _LATIN_LETTERS_RE.search(t) and not _DEVANAGARI_RE.search(t):
        if len(t) <= 6:
            return True
    return False


def drop_obvious_hindi_junk_segments(
    episode_language: str | None,
    segments: list[TranscriptSegmentRecord],
) -> list[TranscriptSegmentRecord]:
    """Remove only obvious junk rows for Hindi; English unchanged."""
    if not is_hindi_language(normalize_video_indexer_language(episode_language)):
        return segments
    return [s for s in segments if not is_obvious_hindi_junk_line(s.text)]


def synthesis_text_for_replacement(
    episode_language: str | None,
    segment: TranscriptSegmentRecord | None,
    replacement_text: str,
) -> str:
    """
    When the user keeps the default romanized line, prefer Devanagari for TTS.
    If they edited the line, speak the edited text (still with Hindi language_code).
    Placeholder display lines use Devanagari from text_original when unchanged.
    """
    t = (replacement_text or "").strip()
    if not t or not segment:
        return t
    lang = normalize_video_indexer_language(episode_language)
    if not is_hindi_language(lang):
        return t
    orig = (segment.text_original or "").strip()
    if not orig:
        return t
    if t == (segment.text or "").strip():
        return orig
    return t
