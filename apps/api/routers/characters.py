from fastapi import APIRouter, HTTPException

from schemas.character import GenerateBody, VoiceBody
from schemas.job import JobOut
from services import character_service, job_service

router = APIRouter()


@router.post("/{character_id}/voice", response_model=JobOut)
def queue_voice(character_id: str, _body: VoiceBody | None = None):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return job_service.create_voice_job(character_id)


@router.post("/{character_id}/generate", response_model=JobOut)
def queue_generate(character_id: str, _body: GenerateBody | None = None):
    if not character_service.get_character(character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return job_service.create_generate_job(character_id)
