from fastapi import APIRouter, HTTPException, Response

from db.store import store
from schemas.voice_clip import VoiceClipOut, VoiceClipPatch
from services.voice_clip_service import clip_to_out

router = APIRouter()


@router.patch("/{clip_id}", response_model=VoiceClipOut)
def patch_clip(clip_id: str, body: VoiceClipPatch):
    data = body.model_dump(exclude_unset=True)
    if not data:
        rec = store.get_voice_clip(clip_id)
        if not rec:
            raise HTTPException(status_code=404, detail="Clip not found")
        return clip_to_out(rec)
    title = data.get("title")
    updated = store.patch_voice_clip(clip_id, title=title)
    if not updated:
        raise HTTPException(status_code=404, detail="Clip not found")
    return clip_to_out(updated)


@router.delete("/{clip_id}", status_code=204)
def delete_clip(clip_id: str):
    if not store.delete_voice_clip(clip_id):
        raise HTTPException(status_code=404, detail="Clip not found")
    return Response(status_code=204)
