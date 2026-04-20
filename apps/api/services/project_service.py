from __future__ import annotations

from db.store import ProjectRecord, store
from schemas.project import ProjectCreate, ProjectOut, ProjectPatch


def list_projects() -> list[ProjectOut]:
    return [_to_out(p) for p in store.list_projects()]


def get_project(project_id: str) -> ProjectOut | None:
    p = store.get_project(project_id)
    return _to_out(p) if p else None


def create_project(body: ProjectCreate) -> ProjectOut:
    rec = store.create_project(
        body.name.strip(),
        body.lead.strip() or "You",
        (body.description or "").strip(),
    )
    return _to_out(rec)


def update_project(project_id: str, body: ProjectPatch) -> ProjectOut | None:
    data = body.model_dump(exclude_unset=True)
    if not data:
        p = store.get_project(project_id)
        return _to_out(p) if p else None
    rec = store.update_project(project_id, **data)
    return _to_out(rec) if rec else None


def delete_project(project_id: str) -> bool:
    return store.delete_project(project_id)


def _to_out(p: ProjectRecord) -> ProjectOut:
    return ProjectOut(
        id=p.id,
        name=p.name,
        status=p.status,
        scene_count=p.scene_count,
        lead=p.lead,
        updated_at=p.updated_at,
        description=p.description or "",
    )
