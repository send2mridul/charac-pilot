"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ImageIcon,
  Mic2,
  Pencil,
  Plus,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto } from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/buttonStyles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";

function avatarSrc(c: CharacterDto): string | null {
  const rel = c.thumbnail_paths?.[0];
  if (!rel) return null;
  return mediaUrl(rel.replace(/^\/media\//, ""));
}

export default function CharactersPage() {
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    loading: projectsLoading,
  } = useProjects();
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState<string | null>(null);
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setCharacters([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listCharacters(activeProjectId)
      .then((rows) => {
        if (!cancelled) setCharacters(rows);
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof ApiError ? e : new ApiError("Request failed", 0, ""),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const active = projects.find((p) => p.id === activeProjectId);

  async function handleAddCharacter(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProjectId || !newName.trim()) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const c = await api.createCharacter(activeProjectId, {
        name: newName.trim(),
        role: newRole.trim(),
        wardrobe_notes: newNotes.trim(),
      });
      setCharacters((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setNewRole("");
      setNewNotes("");
    } catch (err) {
      setCreateErr(
        err instanceof ApiError ? err.message : "Could not create character",
      );
    } finally {
      setCreating(false);
    }
  }

  function openEdit(c: CharacterDto) {
    setEditId(c.id);
    setEditName(c.name);
    setEditRole(c.role);
    setEditNotes(c.wardrobe_notes);
    setEditErr(null);
  }

  async function saveEdit() {
    if (!editId || !editName.trim()) return;
    setEditSaving(true);
    setEditErr(null);
    try {
      const updated = await api.patchCharacter(editId, {
        name: editName.trim(),
        role: editRole.trim(),
        wardrobe_notes: editNotes.trim(),
      });
      setCharacters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      setEditId(null);
    } catch (err) {
      setEditErr(
        err instanceof ApiError ? err.message : "Could not save character",
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function onAvatarFile(characterId: string, file: File | null) {
    if (!file || !activeProjectId) return;
    setAvatarUploading(characterId);
    try {
      const updated = await api.uploadCharacterAvatar(
        activeProjectId,
        characterId,
        file,
      );
      setCharacters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
    } catch {
      /* optional toast */
    } finally {
      setAvatarUploading(null);
      setAvatarTargetId(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Characters"
        subtitle="Add people to your project, attach faces and notes, then give them voices in Voice Studio."
        actions={
          <Link
            href="/upload-match"
            className={buttonClass("secondary", "inline-flex items-center gap-2 px-4")}
          >
            <Upload className="h-4 w-4" />
            Import from Video
          </Link>
        }
      />

      <Panel>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Project
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <select
            className="min-w-[200px] rounded-xl border border-white/[0.08] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
            value={activeProjectId ?? ""}
            disabled={projectsLoading || projects.length === 0}
            onChange={(e) => setActiveProjectId(e.target.value)}
          >
            {projects.length === 0 ? (
              <option value="">No projects</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          {active ? (
            <span className="text-xs text-muted">{active.scene_count} scenes</span>
          ) : null}
        </div>
      </Panel>

      {activeProjectId && !projectsLoading ? (
        <Panel>
          <h2 className="text-sm font-semibold text-text">Add a character</h2>
          <p className="mt-1 text-sm text-muted">
            Manual entry is always available. Import from Video can also create
            characters from detected speakers.
          </p>
          <form
            onSubmit={(e) => void handleAddCharacter(e)}
            className="mt-4 grid gap-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <label className="text-[11px] font-medium text-muted">Name</label>
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                placeholder="e.g. Mara Voss"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted">
                Role (optional)
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                placeholder="Lead, narrator, guest…"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted">
                Notes (optional)
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                placeholder="Wardrobe, mannerisms, context"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating || !newName.trim()}>
                {creating ? (
                  <Spinner className="h-4 w-4 border-t-canvas" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add character
              </Button>
            </div>
          </form>
          {createErr ? (
            <p className="mt-2 text-xs text-red-400">{createErr}</p>
          ) : null}
        </Panel>
      ) : null}

      {error ? (
        <ErrorBanner title="Could not load characters" detail={error.message} />
      ) : null}

      {editId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-panel p-6 ring-1 ring-white/10">
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg p-1 text-muted hover:bg-white/[0.06] hover:text-text"
              onClick={() => setEditId(null)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold text-text">Edit character</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted">Name</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted">Role</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted">Notes</label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            </div>
            {editErr ? (
              <p className="mt-3 text-xs text-red-400">{editErr}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setEditId(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={editSaving || !editName.trim()}
                onClick={() => void saveEdit()}
              >
                {editSaving ? <Spinner className="h-4 w-4 border-t-canvas" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (avatarTargetId) void onAvatarFile(avatarTargetId, f);
        }}
      />

      {projectsLoading || loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <Skeleton className="h-32 w-full" />
          </Panel>
          <Panel>
            <Skeleton className="h-32 w-full" />
          </Panel>
        </div>
      ) : !activeProjectId ? (
        <EmptyState
          icon={BookOpen}
          title="Pick a project"
          description="Create a project first, then choose it above."
        />
      ) : characters.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No characters yet"
          description="Add one above, or use Import from Video after processing a file."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {characters.map((c) => {
            const av = avatarSrc(c);
            return (
              <Panel
                key={c.id}
                className="transition hover:ring-white/10"
              >
                <div className="flex flex-wrap items-start gap-4">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-white/10">
                    {av ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={av}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted">
                        <ImageIcon className="h-6 w-6" />
                      </div>
                    )}
                    {avatarUploading === c.id ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Spinner className="h-5 w-5 border-t-accent" />
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="text-lg font-semibold text-text">{c.name}</h2>
                        <p className="mt-0.5 text-xs text-muted">
                          {c.source_episode_id
                            ? "Imported from video"
                            : "Added manually"}
                        </p>
                        {c.role ? (
                          <p className="mt-1 text-xs text-muted">Role: {c.role}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {c.is_narrator ? (
                          <Badge tone="violet">Narrator</Badge>
                        ) : null}
                        <Button
                          variant="secondary"
                          type="button"
                          className="px-2 py-1 text-xs"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                      </div>
                    </div>
                    {c.wardrobe_notes ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        {c.wardrobe_notes}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
                  <Button
                    variant="secondary"
                    type="button"
                    className="text-xs"
                    disabled={avatarUploading === c.id}
                    onClick={() => {
                      setAvatarTargetId(c.id);
                      fileRef.current?.click();
                    }}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {av ? "Change photo" : "Add photo"}
                  </Button>
                </div>

                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Voice
                    </p>
                    {c.default_voice_id ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-xs font-medium text-text">
                          {c.voice_display_name || c.default_voice_id}
                        </span>
                        {c.voice_source_type ? (
                          <Badge tone="accent">
                            {c.voice_source_type === "catalog"
                              ? "Catalog"
                              : c.voice_source_type === "designed"
                                ? "Designed"
                                : c.voice_source_type === "remixed"
                                  ? "Remixed"
                                  : c.voice_source_type}
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-muted/80">
                        No voice yet. Pick one in Voice Studio.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/voice-studio?character=${encodeURIComponent(c.id)}`}
                        className={buttonClass(
                          "secondary",
                          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs",
                        )}
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        {c.default_voice_id ? "Change voice" : "Attach voice"}
                      </Link>
                      <Link
                        href={`/voice-studio?character=${encodeURIComponent(c.id)}`}
                        className={buttonClass(
                          "outline",
                          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs",
                        )}
                      >
                        <Mic2 className="h-3.5 w-3.5" />
                        Open Voice Studio
                      </Link>
                    </div>
                  </div>

                  {c.sample_texts.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Sample lines
                      </p>
                      <div className="mt-1 space-y-1">
                        {c.sample_texts.slice(0, 4).map((t, i) => (
                          <p
                            key={i}
                            className="line-clamp-2 text-xs italic text-muted"
                          >
                            &ldquo;{t}&rdquo;
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
