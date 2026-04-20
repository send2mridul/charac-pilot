import io
import logging
import re
import shutil
import uuid
import zipfile

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from db.store import store
from schemas.character import (
    AssignVoiceBody,
    BatchGeneratedClipOut,
    CharacterOut,
    ClipLineIn,
    DraftLineOut,
    GenerateBody,
    GenerateClipsBody,
    GenerateClipsOut,
    GenerateClipsFromLinesBody,
    GenerateDraftLinesOut,
    GenerateLinesBody,
    GenerateLinesOut,
    GeneratePreviewBody,
    PatchCharacterBody,
    PreviewOut,
)
from schemas.job import JobOut
from schemas.voice_clip import VoiceClipOut
from services import character_service, job_service
from services.character_avatar import save_character_avatar_file
from services.tts_service import generate_preview
from services.voice_clip_service import list_for_character
from storage_paths import STORAGE_ROOT, ensure_storage_dirs, to_rel_storage_path

router = APIRouter()
log = logging.getLogger("characpilot.characters")


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


def _prompt_to_lines(prompt: str, count: int) -> list[str]:
    pairs = _prompt_to_draft_lines(prompt, count)
    return [p[0] for p in pairs]


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
    chunks = [c.strip(" ,.") for c in normalized.split("|") if c.strip(" ,.")]  # chrono order

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
    # Remove scripting/meta style markers if present.
    text = re.sub(r"\b(scene note|beat|tone|meta)\b\s*:?","", text, flags=re.I)
    text = text.strip(" ,.-")
    return text


def _sanitize_spoken_dialogue(line: str) -> str:
    """Force output into natural spoken dialogue (not narration/stage directions)."""
    text = " ".join((line or "").strip().split())
    if not text:
        return "Can someone tell me what happened?"

    # Strip obvious meta/stage markers.
    text = re.sub(r"\b(scene note|stage direction|beat|meta)\b\s*:?","", text, flags=re.I)
    text = re.sub(r"^[\-\*\[\(].*?[\]\)]\s*", "", text)

    # Convert third-person narration to direct spoken phrasing.
    low = text.lower()
    if re.search(r"\b(he|she|they)\s+(looks?|walks?|smiles?|greets?|asks?|notices?)\b", low):
        if re.search(r"\b(look|notice|quiet|wrong|off|nervous)\b", low):
            text = "Wait, something feels off here."
        elif re.search(r"\b(greet|smile|hello|hi)\b", low):
            text = "Hey everyone, good to see you."
        elif re.search(r"\b(ask|what happened)\b", low):
            text = "Can someone tell me what happened?"
        else:
            text = "I need to understand what is going on."

    # Fix common broken conjugations in generated phrases.
    text = re.sub(r"\bI\s+smiles\b", "I smile", text, flags=re.I)
    text = re.sub(r"\bI\s+looks\b", "I look", text, flags=re.I)
    text = re.sub(r"\bI\s+asks\b", "I ask", text, flags=re.I)
    text = re.sub(r"\bI\s+greets\b", "I greet", text, flags=re.I)
    text = re.sub(r"\bI\s+notices\b", "I notice", text, flags=re.I)

    text = text.strip(" ,.-")
    if not text:
        text = "Can someone tell me what happened?"
    if text[-1] not in ".?!":
        text += "."
    return text


def _beat_to_dialogue(beat: str) -> str:
    b = _normalize_beat_text(beat)
    low = b.lower()
    # Strong intent-based mapping to stay close to scene beats.
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

    # Convert third-person beat text into first-person dialogue.
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
    return _sanitize_spoken_dialogue(line)


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


def _prompt_to_draft_lines(prompt: str, count: int | None = None) -> list[tuple[str, str]]:
    """Return scene-ordered draft lines with tone labels."""
    seed = " ".join(prompt.strip().split())
    if not seed:
        return []

    requested = _extract_requested_line_count(seed)
    if requested is not None:
        target = max(1, min(requested, 12))
    else:
        base = 4 if count is None else int(count)
        target = max(3, min(base, 5))

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


def _generate_and_store_clips(
    *,
    character_id: str,
    project_id: str,
    voice_id: str,
    voice_name: str,
    source_lines: list[ClipLineIn],
    default_style: str,
    clip_label_prefix: str,
) -> tuple[list[BatchGeneratedClipOut], str]:
    ensure_storage_dirs()
    created: list[BatchGeneratedClipOut] = []
    provider_used = "stub"
    prefix = clip_label_prefix.strip()

    for idx, line_in in enumerate(source_lines, start=1):
        text = (line_in.text or "").strip()
        if not text:
            continue
        line_style = (line_in.tone_style or "").strip() or default_style
        result = generate_preview(
            character_id=character_id,
            text=text,
            voice_id=voice_id,
            style=line_style or None,
        )
        provider_used = str(result.get("provider") or provider_used)
        rel_preview = str(result.get("audio_relpath") or "")
        src = STORAGE_ROOT / rel_preview
        if not src.is_file():
            continue
        clip_uid = f"vcp-{uuid.uuid4().hex[:12]}"
        clip_dir = STORAGE_ROOT / "clips" / character_id
        clip_dir.mkdir(parents=True, exist_ok=True)
        ext = src.suffix or ".wav"
        dest = clip_dir / f"{clip_uid}{ext}"
        shutil.copy2(src, dest)
        clip_rel = to_rel_storage_path(dest)
        if prefix:
            title = f"{prefix} {idx}"
        else:
            snippet = " ".join(text.split())[:36].strip()
            title = snippet if snippet else f"Clip {idx}"
        rec = store.create_voice_clip(
            character_id=character_id,
            project_id=project_id,
            voice_id=voice_id,
            voice_name=voice_name,
            text=text,
            tone_style_hint=line_style,
            audio_path=clip_rel,
            title=title,
        )
        created.append(
            BatchGeneratedClipOut(
                clip_id=rec.id,
                title=rec.title,
                text=rec.text,
                audio_url=f"/media/{rec.audio_path}",
                tone_style_hint=rec.tone_style_hint,
                created_at=rec.created_at,
            )
        )

    return created, provider_used


# --- Register all /{character_id}/... subpaths before bare /{character_id} (GET/PATCH).


@router.get("/{character_id}/clips", response_model=list[VoiceClipOut])
def list_character_clips(character_id: str):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return list_for_character(character_id)


@router.get("/{character_id}/clips/download-all")
def download_character_clips_zip(character_id: str):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    rows = store.list_voice_clips_for_character(character_id)
    if not rows:
        raise HTTPException(status_code=404, detail="No clips for this character yet")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, rec in enumerate(rows):
            path = STORAGE_ROOT / rec.audio_path
            if not path.is_file():
                continue
            safe = "".join(
                ch if ch.isalnum() or ch in "._- " else "_" for ch in (rec.title or rec.id)
            ).strip()[:48] or rec.id
            ext = path.suffix or ".wav"
            zf.write(path, arcname=f"{i + 1:03d}_{safe}{ext}")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="castvoice-clips-{character_id}.zip"',
        },
    )


@router.post("/{character_id}/avatar", response_model=CharacterOut)
async def upload_character_avatar(character_id: str, file: UploadFile = File(...)):
    return await save_character_avatar_file(character_id, file)


@router.post("/{character_id}/voice", response_model=CharacterOut)
def assign_voice(character_id: str, body: AssignVoiceBody):
    """Save a voice from the catalog (or custom ID) as the character's default voice."""
    log.info("POST /characters/%s/voice voice_id=%s", character_id, body.voice_id)
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    st = body.voice_source_type or "catalog"
    extra: dict = {
        "default_voice_id": body.voice_id,
        "voice_display_name": body.display_name or body.voice_id,
        "voice_source_type": st,
    }
    if st == "catalog":
        extra["voice_provider"] = body.provider or "catalog"
        extra["voice_parent_id"] = None
        extra["voice_description_meta"] = None
    else:
        extra["voice_provider"] = body.provider or "elevenlabs"
    updated = character_service.update_character(character_id, **extra)
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


@router.post("/{character_id}/generate", response_model=JobOut)
def queue_generate(character_id: str, _body: GenerateBody | None = None):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return job_service.create_generate_job(character_id)


@router.post("/{character_id}/generate-preview", response_model=PreviewOut)
def generate_preview_endpoint(character_id: str, body: GeneratePreviewBody):
    log.info("POST /characters/%s/generate-preview text=%s", character_id, body.text[:80])
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    try:
        result = generate_preview(
            character_id=character_id,
            text=body.text,
            voice_id=body.voice_id or c.default_voice_id,
            style=body.style,
        )
    except Exception as e:
        log.exception("generate-preview failed character_id=%s", character_id)
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e

    clip_id: str | None = None
    audio_url = result["audio_url"]
    rel_preview = str(result.get("audio_relpath") or "")

    if body.save_clip and rel_preview:
        src = STORAGE_ROOT / rel_preview
        if src.is_file():
            ensure_storage_dirs()
            clip_uid = f"vcp-{uuid.uuid4().hex[:12]}"
            clip_dir = STORAGE_ROOT / "clips" / character_id
            clip_dir.mkdir(parents=True, exist_ok=True)
            ext = src.suffix or ".wav"
            dest = clip_dir / f"{clip_uid}{ext}"
            shutil.copy2(src, dest)
            clip_rel = to_rel_storage_path(dest)
            vid = (body.voice_id or c.default_voice_id) or ""
            vname = (c.voice_display_name or "") if c else ""
            hint = (body.style or "").strip()
            title_raw = (body.clip_title or "").strip()
            title = title_raw or f"Line {clip_uid[-4:]}"
            rec = store.create_voice_clip(
                character_id=character_id,
                project_id=c.project_id,
                voice_id=vid,
                voice_name=vname,
                text=body.text,
                tone_style_hint=hint,
                audio_path=clip_rel,
                title=title,
            )
            clip_id = rec.id
            audio_url = f"/media/{clip_rel}"

    character_service.update_character(character_id, preview_audio_path=audio_url)
    return PreviewOut(
        preview_id=result["preview_id"],
        character_id=result["character_id"],
        audio_url=audio_url,
        duration_ms=result["duration_ms"],
        text=result["text"],
        provider=result["provider"],
        clip_id=clip_id,
    )


@router.post("/{character_id}/generate-lines", response_model=GenerateLinesOut)
def generate_lines_endpoint(character_id: str, body: GenerateLinesBody):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    lines = _prompt_to_lines(prompt, body.count)
    if not lines:
        raise HTTPException(status_code=400, detail="Could not generate lines")

    return GenerateLinesOut(
        character_id=character_id,
        prompt=prompt,
        generated_count=len(lines),
        lines=lines,
    )


@router.post("/{character_id}/generate-draft-lines", response_model=GenerateDraftLinesOut)
def generate_draft_lines_endpoint(character_id: str, body: GenerateLinesBody):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    pairs = _prompt_to_draft_lines(prompt, body.count)
    if not pairs:
        raise HTTPException(status_code=400, detail="Could not generate draft lines")

    structured = [
        DraftLineOut(order=i + 1, text=text, tone_style=tone)
        for i, (text, tone) in enumerate(pairs)
    ]
    return GenerateDraftLinesOut(
        character_id=character_id,
        prompt=prompt,
        generated_count=len(structured),
        lines=structured,
    )


@router.post("/{character_id}/generate-clips", response_model=GenerateClipsOut)
def generate_clips_endpoint(character_id: str, body: GenerateClipsBody):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    voice_id = body.voice_id or c.default_voice_id
    if not voice_id:
        raise HTTPException(status_code=400, detail="Assign a voice first")

    mode = (body.mode or "multi_line").strip().lower()
    if mode not in {"multi_line", "prompt"}:
        raise HTTPException(status_code=400, detail="Unsupported mode")

    source_lines: list[str]
    if mode == "prompt":
        source_lines = _prompt_to_lines(body.prompt or "", body.count)
    else:
        source_lines = [ln.strip() for ln in (body.lines or []) if ln.strip()]

    if not source_lines:
        raise HTTPException(status_code=400, detail="No clip text provided")

    style = (body.style or "").strip()
    line_objs = [ClipLineIn(text=line, tone_style=style) for line in source_lines]
    created, provider_used = _generate_and_store_clips(
        character_id=character_id,
        project_id=c.project_id,
        voice_id=voice_id,
        voice_name=(c.voice_display_name or ""),
        source_lines=line_objs,
        default_style=style,
        clip_label_prefix=(body.clip_label_prefix or ""),
    )

    if not created:
        raise HTTPException(status_code=500, detail="Could not generate clips")

    character_service.update_character(character_id, preview_audio_path=created[-1].audio_url)
    return GenerateClipsOut(
        character_id=character_id,
        mode=mode,
        provider=provider_used,
        generated_count=len(created),
        clips=created,
    )


@router.post("/{character_id}/generate-clips-from-lines", response_model=GenerateClipsOut)
def generate_clips_from_lines_endpoint(character_id: str, body: GenerateClipsFromLinesBody):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")

    voice_id = body.voice_id or c.default_voice_id
    if not voice_id:
        raise HTTPException(status_code=400, detail="Assign a voice first")

    source_lines = [ln for ln in body.lines if (ln.text or "").strip()]
    if not source_lines:
        raise HTTPException(status_code=400, detail="No approved lines provided")

    created, provider_used = _generate_and_store_clips(
        character_id=character_id,
        project_id=c.project_id,
        voice_id=voice_id,
        voice_name=(c.voice_display_name or ""),
        source_lines=source_lines,
        default_style=(body.style or "").strip(),
        clip_label_prefix=(body.clip_label_prefix or ""),
    )
    if not created:
        raise HTTPException(status_code=500, detail="Could not generate clips")

    character_service.update_character(character_id, preview_audio_path=created[-1].audio_url)
    return GenerateClipsOut(
        character_id=character_id,
        mode="reviewed_lines",
        provider=provider_used,
        generated_count=len(created),
        clips=created,
    )


@router.patch("/{character_id}", response_model=CharacterOut)
def patch_character(character_id: str, body: PatchCharacterBody):
    log.info("PATCH /characters/%s body=%s", character_id, body.model_dump(exclude_none=True))
    updates = body.model_dump(exclude_none=True)
    if not updates:
        c = character_service.get_character(character_id)
        if not c:
            raise HTTPException(status_code=404, detail="Character not found")
        return c
    updated = character_service.update_character(character_id, **updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Character not found")
    return updated


@router.get("/{character_id}", response_model=CharacterOut)
def get_character(character_id: str):
    c = character_service.get_character(character_id)
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    return c
