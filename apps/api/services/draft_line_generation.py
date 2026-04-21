from __future__ import annotations

import json
import logging
import os
import re
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass

log = logging.getLogger("characpilot.draft_lines")

_NUMBER_WORDS: dict[str, int] = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
}

_BAD_META_RE = re.compile(r"\b(scene note|stage direction|beat|meta)\b", re.I)
_BAD_GRAMMAR_RE = re.compile(r"\bI\s+(rushes|thinks|stops|looks|smiles|asks|greets|notices)\b", re.I)


@dataclass
class DraftLine:
    order: int
    text: str
    tone_style: str


@dataclass
class DraftLineGenerationResult:
    lines: list[DraftLine]
    provider_used: str
    fallback_used: bool


@dataclass
class ProviderCallResult:
    parsed_items: list[dict] | None
    error_kind: str | None = None


def generate_draft_lines(prompt: str, count: int | None = None) -> DraftLineGenerationResult:
    target = _target_count(prompt, count)
    llm_result = _generate_with_llm(prompt, target)
    if llm_result:
        return llm_result

    pairs = _heuristic_prompt_to_draft_lines(prompt, target)
    lines = [
        DraftLine(order=i + 1, text=text, tone_style=tone)
        for i, (text, tone) in enumerate(pairs)
    ]
    return DraftLineGenerationResult(lines=lines, provider_used="fallback", fallback_used=True)


def generate_line_texts(prompt: str, count: int | None = None) -> list[str]:
    return [x.text for x in generate_draft_lines(prompt, count).lines]


def _target_count(prompt: str, count: int | None) -> int:
    requested = _extract_requested_line_count(prompt)
    if requested is not None:
        return max(1, min(requested, 12))
    base = 4 if count is None else int(count)
    return max(3, min(base, 5))


def _extract_requested_line_count(prompt: str) -> int | None:
    low = prompt.lower()
    digit_match = re.search(
        r"\b(\d{1,2})\s*(?:lines?|dialogue lines?|responses?|variations?|greetings?)\b",
        low,
    )
    if digit_match:
        return int(digit_match.group(1))

    word_match = re.search(
        r"\b("
        + "|".join(_NUMBER_WORDS.keys())
        + r")\s*(?:lines?|dialogue lines?|responses?|variations?|greetings?)\b",
        low,
    )
    if word_match:
        return _NUMBER_WORDS[word_match.group(1)]
    return None


def _generate_with_llm(prompt: str, target: int) -> DraftLineGenerationResult | None:
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("TEMP_GEMINI_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    log.info(
        "draft line provider check gemini_key=%s openai_key=%s target=%s",
        "set" if gemini_key else "unset",
        "set" if openai_key else "unset",
        target,
    )

    if gemini_key:
        lines = _llm_with_retry(prompt, target, provider="gemini")
        if lines:
            log.info("draft line provider selected=gemini fallback_used=false")
            return DraftLineGenerationResult(lines=lines, provider_used="ai", fallback_used=False)

    if openai_key:
        lines = _llm_with_retry(prompt, target, provider="openai")
        if lines:
            log.info("draft line provider selected=openai fallback_used=false")
            return DraftLineGenerationResult(lines=lines, provider_used="ai", fallback_used=False)

    log.warning("draft line provider selected=heuristic reason=no_llm_or_llm_failed")
    return None


def _llm_with_retry(prompt: str, target: int, provider: str) -> list[DraftLine] | None:
    log.info("draft line %s attempt=1", provider)
    first = _call_provider(provider, prompt, target, corrective=False)
    if first.error_kind in {"timeout", "network"}:
        log.warning(
            "draft line %s attempt=1 failed error_kind=%s; retrying same request",
            provider,
            first.error_kind,
        )
        log.info("draft line %s attempt=2 reason=network_retry", provider)
        second_same = _call_provider(provider, prompt, target, corrective=False)
        if second_same.error_kind in {"timeout", "network"}:
            log.warning(
                "draft line %s fallback reason=%s after network retry",
                provider,
                second_same.error_kind,
            )
            return None
        candidate_items = second_same.parsed_items
    else:
        candidate_items = first.parsed_items

    normalized = _normalize_candidate_lines(candidate_items, target)
    if _is_valid_lines(normalized):
        return normalized

    log.warning("draft line %s output invalid; retrying once with corrective prompt", provider)
    log.info("draft line %s attempt=3 reason=validation_retry", provider)
    second = _call_provider(provider, prompt, target, corrective=True)
    if second.error_kind in {"timeout", "network"}:
        log.warning(
            "draft line %s fallback reason=%s during validation retry",
            provider,
            second.error_kind,
        )
        return None
    normalized_retry = _normalize_candidate_lines(second.parsed_items, target)
    if _is_valid_lines(normalized_retry):
        return normalized_retry

    log.warning("draft line %s fallback reason=invalid_content_after_retry", provider)
    return None


def _call_provider(provider: str, prompt: str, target: int, corrective: bool) -> ProviderCallResult:
    system_instruction = (
        "You write spoken dialogue for one character.\n"
        "Return ONLY valid JSON array.\n"
        "Each item must be object: {\"order\": number, \"text\": string, \"tone_style\": string}.\n"
        "Rules:\n"
        "- Spoken dialogue only, no narration.\n"
        "- No stage directions.\n"
        "- No scene-note/meta text.\n"
        "- Natural grammar and conversational phrasing.\n"
        "- Follow scene progression in order.\n"
        "- Keep lines concise and TTS-ready.\n"
        "- Tone must match line content.\n"
        "- No duplicate lines.\n"
    )
    corrective_note = (
        "Previous output failed validation. Fix all issues and return only valid JSON array with clean spoken dialogue."
        if corrective
        else ""
    )
    user_prompt = (
        f"Scene prompt:\n{prompt}\n\n"
        f"Generate {target} lines.\n"
        "Output JSON array only."
    )
    if corrective_note:
        user_prompt = f"{user_prompt}\n\n{corrective_note}"

    try:
        if provider == "gemini":
            content = _call_gemini(system_instruction, user_prompt)
        else:
            content = _call_openai(system_instruction, user_prompt)
        if not content:
            return ProviderCallResult(parsed_items=None, error_kind="empty_content")
        parsed = _parse_json_array(content)
        if isinstance(parsed, list):
            return ProviderCallResult(parsed_items=parsed, error_kind=None)
        return ProviderCallResult(parsed_items=None, error_kind="invalid_json")
    except TimeoutError as exc:
        log.warning("draft line provider %s timeout: %s", provider, exc)
        return ProviderCallResult(parsed_items=None, error_kind="timeout")
    except socket.timeout as exc:
        log.warning("draft line provider %s timeout: %s", provider, exc)
        return ProviderCallResult(parsed_items=None, error_kind="timeout")
    except urllib.error.URLError as exc:
        reason = str(getattr(exc, "reason", exc))
        low = reason.lower()
        kind = "timeout" if "timed out" in low or "timeout" in low else "network"
        log.warning("draft line provider %s network_error kind=%s detail=%s", provider, kind, reason)
        return ProviderCallResult(parsed_items=None, error_kind=kind)
    except Exception as exc:
        log.warning("draft line provider %s failed: %s", provider, exc)
        return ProviderCallResult(parsed_items=None, error_kind="provider_error")


def _call_gemini(system_instruction: str, user_prompt: str) -> str:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("TEMP_GEMINI_API_KEY") or ""
    model = os.environ.get("GEMINI_DRAFT_LINE_MODEL", "gemini-3-flash-preview")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    if not key:
        raise RuntimeError("Gemini key is not configured")

    # Keep request format aligned with known working manual call pattern.
    merged_prompt = f"{system_instruction}\n\n{user_prompt}"
    payload = {
        "contents": [{"parts": [{"text": merged_prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json",
        },
    }
    timeout_seconds = float(os.environ.get("GEMINI_DRAFT_LINE_TIMEOUT_SEC", "90"))
    log.info("draft line gemini request model=%s timeout_sec=%s", model, timeout_seconds)
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-goog-api-key": key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"Gemini HTTP {e.code}: {detail[:300]}") from e
    except socket.timeout as e:
        raise TimeoutError(f"Gemini read timeout after {timeout_seconds}s") from e
    except urllib.error.URLError as e:
        reason = str(getattr(e, "reason", e))
        if isinstance(getattr(e, "reason", None), socket.timeout) or "timed out" in reason.lower():
            raise TimeoutError(f"Gemini connect/read timeout after {timeout_seconds}s") from e
        raise

    return (
        body.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )


def _call_openai(system_instruction: str, user_prompt: str) -> str:
    key = os.environ.get("OPENAI_API_KEY", "")
    model = os.environ.get("OPENAI_DRAFT_LINE_MODEL", "gpt-4o-mini")
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_prompt + '\nUse key "lines" for the output array.'},
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"OpenAI HTTP {e.code}: {detail[:300]}") from e

    content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    return content


def _parse_json_array(content: str):
    raw = (content or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", raw)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None

    if isinstance(parsed, dict) and isinstance(parsed.get("lines"), list):
        return parsed["lines"]
    return parsed


def _normalize_candidate_lines(items: list[dict] | None, target: int) -> list[DraftLine]:
    if not items:
        return []

    out: list[DraftLine] = []
    seen: set[str] = set()
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        text = _sanitize_spoken_dialogue(str(item.get("text", "")).strip())
        tone = " ".join(str(item.get("tone_style", "")).strip().split())
        if not text or not tone:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(DraftLine(order=len(out) + 1, text=text, tone_style=tone))
        if len(out) >= target:
            break
    return out


def _is_valid_lines(lines: list[DraftLine]) -> bool:
    if not lines:
        return False
    seen: set[str] = set()
    for line in lines:
        text = (line.text or "").strip()
        tone = (line.tone_style or "").strip()
        if not text or not tone:
            return False
        low = text.lower()
        if _BAD_META_RE.search(low):
            return False
        if _BAD_GRAMMAR_RE.search(text):
            return False
        if re.search(r"\b(he|she|they)\s+(looks?|walks?|smiles?|asks?|greets?|notices?)\b", low):
            return False
        if low in seen:
            return False
        seen.add(low)
    return True


def _sanitize_spoken_dialogue(line: str) -> str:
    text = " ".join((line or "").strip().split())
    if not text:
        return ""
    text = re.sub(r"\b(scene note|stage direction|beat|meta)\b\s*:?", "", text, flags=re.I)
    text = re.sub(r"^[\-\*\[\(].*?[\]\)]\s*", "", text)
    text = text.strip(" ,.-")
    if text and text[-1] not in ".?!":
        text += "."
    return text


# --- Heuristic fallback (kept for no-key and invalid LLM output) ---


def _split_scene_beats(prompt: str) -> list[str]:
    seed = " ".join(prompt.strip().split())
    if not seed:
        return []
    normalized = re.sub(
        r"\b(first|initially|to start|then|next|after that|afterwards|finally|in the end|at last)\b",
        "|",
        seed,
        flags=re.I,
    )
    normalized = re.sub(r"[;]+", "|", normalized)
    chunks = [c.strip(" ,.") for c in normalized.split("|") if c.strip(" ,.")]

    beats: list[str] = []
    for chunk in chunks:
        sub_chunks = re.split(r"\b(?:and then|then|finally)\b", chunk, flags=re.I)
        for sc in sub_chunks:
            cleaned = sc.strip(" ,.")
            if cleaned:
                beats.append(cleaned)
    return beats or [seed]


def _normalize_beat_text(beat: str) -> str:
    text = " ".join(beat.strip().split())
    text = re.sub(r"[\(\)\[\]\{\}]", "", text)
    text = re.sub(r"\b(scene note|beat|tone|meta)\b\s*:?", "", text, flags=re.I)
    return text.strip(" ,.-")


def _beat_to_dialogue(beat: str) -> str:
    b = _normalize_beat_text(beat)
    low = b.lower()
    if re.search(r"\b(walks? into|walks? in|enters?|arrives?)\b", low):
        if re.search(r"\blong day\b", low):
            return "Hey everyone, long day, but I am glad to be here."
        return "Hey everyone, I just got in."
    if re.search(r"\b(greet|greets|greeting|hello|hi|welcome)\b", low):
        return "Hey everyone, it is really good to see you."
    if re.search(r"\b(notice|notices|realize|realizes|wrong|off|tense|tension|quiet)\b", low):
        return "Hold on, something feels off here."
    if re.search(r"\b(ask|asks|asked|what happened|what's happened|what is happening)\b", low):
        return "Can someone calmly tell me what happened?"
    if re.search(r"\b(apologize|sorry)\b", low):
        return "I am sorry, I should have handled that better."
    if re.search(r"\b(thank|grateful)\b", low):
        return "Thank you, I really appreciate this."

    line = re.sub(r"\b(he|she|they)\b", "I", b, flags=re.I)
    line = re.sub(r"^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+", "", line)
    line = re.sub(r"\bwalks\b", "walk", line, flags=re.I)
    line = re.sub(r"\bnotices\b", "notice", line, flags=re.I)
    line = re.sub(r"\basks\b", "ask", line, flags=re.I)
    line = re.sub(r"\bgreets\b", "greet", line, flags=re.I)
    line = re.sub(r"\bfeels\b", "feel", line, flags=re.I)
    line = line.strip()
    if not line:
        return "I need to understand what is happening right now."
    if not re.match(r"^(I|Hey|Can|Please|Let us|Let's)\b", line, flags=re.I):
        line = f"I {line[0].lower()}{line[1:]}" if len(line) > 1 else f"I {line}"
    line = re.sub(r"\bI\s+smiles\b", "I smile", line, flags=re.I)
    line = re.sub(r"\bI\s+looks\b", "I look", line, flags=re.I)
    line = re.sub(r"\bI\s+asks\b", "I ask", line, flags=re.I)
    line = re.sub(r"\bI\s+greets\b", "I greet", line, flags=re.I)
    line = re.sub(r"\bI\s+notices\b", "I notice", line, flags=re.I)
    return _sanitize_spoken_dialogue(line) or "Can someone tell me what happened?"


def _infer_tone_label(beat: str, line: str) -> str:
    text = f"{beat} {line}".lower()
    if re.search(r"\b(long day|just got in|glad to be here)\b", text):
        return "warm and slightly tired"
    if re.search(r"\b(greet|hello|hi|welcome|good to see)\b", text):
        return "warm and welcoming"
    if re.search(r"\b(wrong|off|tense|tension|hold on|notice|realize)\b", text):
        return "concerned and observant"
    if re.search(r"\b(what happened|what is happening|tell me)\b", text):
        return "calm and serious"
    if re.search(r"\b(urgent|now|quickly|immediately)\b", text):
        return "urgent and direct"
    if re.search(r"\b(sorry|apologize)\b", text):
        return "apologetic and sincere"
    if re.search(r"\b(thank|grateful)\b", text):
        return "grateful and sincere"
    return "grounded and natural"


def _heuristic_prompt_to_draft_lines(prompt: str, target: int) -> list[tuple[str, str]]:
    seed = " ".join(prompt.strip().split())
    if not seed:
        return []

    beats = _split_scene_beats(seed)
    if len(beats) < target:
        expanded: list[str] = []
        for beat in beats:
            parts = re.split(r"\b(?:and|but|so)\b", beat, flags=re.I)
            expanded.extend([p.strip(" ,.") for p in parts if p.strip(" ,.")])
        beats = expanded or beats

    if len(beats) > target:
        beats = beats[:target]
    elif len(beats) < target:
        while len(beats) < target:
            beats.append(beats[-1] if beats else seed)

    out: list[tuple[str, str]] = []
    for beat in beats:
        text = _beat_to_dialogue(beat)
        tone = _infer_tone_label(beat, text)
        out.append((text, tone))
    return out
