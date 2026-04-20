from __future__ import annotations

from db.store import ProjectRecord, store
from schemas.project import ProjectCreate, ProjectOut


def list_projects() -> list[ProjectOut]:
    return [_to_out(p) for p in store.list_projects()]


def get_project(project_id: str) -> ProjectOut | None:
    p = store.get_project(project_id)
    return _to_out(p) if p else None


def create_project(body: ProjectCreate) -> ProjectOut:
    rec = store.create_project(body.name, body.lead)
    return _to_out(rec)


def _to_out(p: ProjectRecord) -> ProjectOut:
    return ProjectOut(
        id=p.id,
        name=p.name,
        status=p.status,
        scene_count=p.scene_count,
        lead=p.lead,
        updated_at=p.updated_at,
    )
