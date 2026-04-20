from fastapi import APIRouter, HTTPException

from schemas.job import JobOut
from services import job_service

router = APIRouter()


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str):
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
