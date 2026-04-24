from fastapi import APIRouter, Depends, HTTPException

from auth import check_ownership, require_user_id
from db.store import store
from schemas.job import JobOut
from services import job_service

router = APIRouter()


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, user_id: str = Depends(require_user_id)):
    owner = store.job_owner_id(job_id)
    if owner is not None:
        check_ownership(owner, user_id)
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
