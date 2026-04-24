"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Camera,
  ChevronDown,
  ImageIcon,
  Mic2,
  Pencil,
  Play,
  Plus,
  Quote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto, EpisodeDto } from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { playVoicePreview, stopVoicePreview } from "@/lib/audio/voicePreviewPlayer";
import { VoiceWave } from "@/components/characters/VoiceWave";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/buttonStyles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Spinner } from "@/components/ui/Spinner";

function avatarSrc(c: CharacterDto): string | null {
  const rel = c.thumbnail_paths?.[0];
  if (!rel) return null;
  return mediaUrl(rel.replace(/^\/media\//, ""));
}

const accentRibbon = {
  teal: "from-primary/20 to-primary/5",
  amber: "from-amber-500/20 to-amber-500/5",
  violet: "from-violet-500/20 to-violet-500/5",
} as const;

type AccentKey = keyof typeof accentRibbon;

function accentForIndex(i: number): AccentKey {
  const keys: AccentKey[] = ["teal", "amber", "violet"];
  return keys[i % keys.length]!;
}

function voiceStatus(
  c: CharacterDto,
): "Designed" | "Draft" | "Pending" {
  if (!c.default_voice_id) return "Pending";
  const t = (c.voice_source_type || "").toLowerCase();
  if (t === "designed" || t === "remixed") return "Designed";
  if (t === "catalog") return "Draft";
  return "Draft";
}

export default function CharactersPage() {
  const toast = useToast();
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
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [voicePreviewPlayingId, setVoicePreviewPlayingId] = useState<
    string | null
  >(null);
  const [confirmRemoveChar, setConfirmRemoveChar] = useState<CharacterDto | null>(null);
  const [confirmDetachVoice, setConfirmDetachVoice] = useState<CharacterDto | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeDto[]>([]);

  useEffect(() => {
    return () => stopVoicePreview();
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setEpisodes([]);
      return;
    }
    let cancelled = false;
    api
      .listEpisodes(activeProjectId)
      .then((rows) => {
        if (!cancelled) setEpisodes(rows);
      })
      .catch(() => {
        if (!cancelled) setEpisodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

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
  const voicedCount = characters.filter((c) => c.default_voice_id).length;

  const episodeTitleById = Object.fromEntries(
    episodes.map((e) => [e.id, e.title]),
  );

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
      toast("Character created");
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

  function removeCharacter(c: CharacterDto) {
    setConfirmRemoveChar(c);
  }

  async function executeRemoveCharacter() {
    const c = confirmRemoveChar;
    if (!c) return;
    setConfirmRemoveChar(null);
    try {
      await api.deleteCharacter(c.id);
      setCharacters((prev) => prev.filter((x) => x.id !== c.id));
      if (editId === c.id) setEditId(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError("Could not delete character", 0, ""),
      );
    }
  }

  function detachVoice(c: CharacterDto) {
    setConfirmDetachVoice(c);
  }

  async function executeDetachVoice() {
    const c = confirmDetachVoice;
    if (!c) return;
    setConfirmDetachVoice(null);
    try {
      const updated = await api.clearCharacterVoice(c.id);
      setCharacters((prev) =>
        prev.map((x) => (x.id === updated.id ? updated : x)),
      );
      toast("Voice removed");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError("Could not clear voice", 0, ""),
      );
    }
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
      toast("Character updated");
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
      toast("Character photo updated");
    } catch {
      /* optional toast */
    } finally {
      setAvatarUploading(null);
      setAvatarTargetId(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function playCurrentVoice(character: CharacterDto) {
    if (!character.default_voice_id) return;
    setPreviewLoadingId(character.id);
    try {
      const existingPreview = (character.preview_audio_path || "").trim();
      if (existingPreview) {
        const rel = existingPreview.replace(/^\/media\//, "");
        await playVoicePreview(mediaUrl(rel), {
          onPlay: () => setVoicePreviewPlayingId(character.id),
          onEnd: () =>
            setVoicePreviewPlayingId((id) =>
              id === character.id ? null : id,
            ),
        });
        return;
      }

      const preview = await api.generatePreview(character.id, {
        text: "This is a short preview of the attached voice.",
        voice_id: character.default_voice_id,
        save_clip: false,
      });
      await playVoicePreview(
        mediaUrl(preview.audio_url.replace(/^\/media\//, "")),
        {
          onPlay: () => setVoicePreviewPlayingId(character.id),
          onEnd: () =>
            setVoicePreviewPlayingId((id) =>
              id === character.id ? null : id,
            ),
        },
      );
    } catch {
      /* ignore transient play errors */
    } finally {
      setPreviewLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="h-16 shrink-0 bg-surface border-b border-border flex items-center px-10 gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[18px] font-bold tracking-tight truncate">Characters</h1>
          <span className="text-[13px] text-foreground-muted hidden sm:block">
            Your full cast roster. {characters.length} character{characters.length === 1 ? "" : "s"}{voicedCount > 0 ? `, ${voicedCount} voiced` : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/upload-match"
            className={buttonClass(
              "secondary",
              "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-canvas transition-colors",
            )}
          >
            <Upload className="size-3.5" />
            Import from Video
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="px-10 py-8 max-w-[1600px] mx-auto space-y-8">

      <section className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="label-eyebrow text-foreground-muted">Project</span>
            <div className="relative">
              <select
                className="appearance-none rounded-lg border border-border bg-canvas py-1.5 pl-3 pr-8 text-[13px] font-semibold text-foreground outline-none transition-colors hover:border-foreground/40 focus:ring-2 focus:ring-primary/20"
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
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted">
                <ChevronDown className="size-3.5" />
              </span>
            </div>
          </div>
        </div>

        {activeProjectId && !projectsLoading ? (
          <div className="px-6 py-5">
            <div className="mb-4">
              <h2 className="text-[16px] font-bold tracking-tight">Add a character</h2>
              <p className="mt-0.5 text-[13px] text-foreground-muted">
                Manual entry. Import from Video can also create characters from detected speakers.
              </p>
            </div>
            <form onSubmit={(e) => void handleAddCharacter(e)} className="space-y-3">
              <div>
                <label className="label-eyebrow mb-1 block text-foreground-muted">Name</label>
                <input
                  className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-[13px] text-foreground outline-none placeholder:text-foreground-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. Mara Voss"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="label-eyebrow mb-1 block text-foreground-muted">
                    Role <span className="opacity-50">(optional)</span>
                  </label>
                  <input
                    className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="Lead, narrator, guest..."
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-eyebrow mb-1 block text-foreground-muted">
                    Notes <span className="opacity-50">(optional)</span>
                  </label>
                  <input
                    className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="Wardrobe, mannerisms, context"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                >
                  {creating ? (
                    <Spinner className="size-4 border-t-background" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Add character
                </button>
              </div>
            </form>
            {createErr ? <p className="mt-2 text-xs text-red-600">{createErr}</p> : null}
          </div>
        ) : null}
      </section>

      {error ? <ErrorBanner title="Could not load characters" detail={error.message} /> : null}

      {editId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-md">
            <button
              type="button"
              className="absolute right-4 top-4 rounded-md p-1 text-foreground-muted hover:bg-canvas hover:text-foreground"
              onClick={() => setEditId(null)}
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
            <h2 className="text-[16px] font-bold tracking-tight">Edit character</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="label-eyebrow mb-1 block text-foreground-muted">Name</label>
                <input
                  className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="label-eyebrow mb-1 block text-foreground-muted">Role</label>
                <input
                  className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                />
              </div>
              <div>
                <label className="label-eyebrow mb-1 block text-foreground-muted">Notes</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            </div>
            {editErr ? (
              <p className="mt-3 text-xs text-red-600">{editErr}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={!editId || avatarUploading === editId}
                onClick={() => {
                  if (!editId) return;
                  setAvatarTargetId(editId);
                  fileRef.current?.click();
                }}
              >
                {editId && avatarUploading === editId ? (
                  <Spinner className="h-4 w-4 border-t-foreground" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Change photo
              </Button>
              <Button variant="secondary" type="button" onClick={() => setEditId(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={editSaving || !editName.trim()}
                onClick={() => void saveEdit()}
              >
                {editSaving ? <Spinner className="h-4 w-4 border-t-primary-foreground" /> : null}
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
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-5">
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="mt-3 h-4 w-3/4" />
            </div>
          ))}
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
        <>
          <div className="flex items-end justify-between pb-4">
            <div>
              <h2 className="text-[18px] font-bold tracking-tight">Your cast</h2>
              <p className="text-[13px] text-foreground-muted mt-0.5">
                {characters.length} total, {voicedCount} voices designed
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {characters.map((c, idx) => {
              const av = avatarSrc(c);
              const accent = accentForIndex(idx);
              const vstat = voiceStatus(c);
              return (
                <article
                  key={c.id}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface hover:border-border-strong hover:shadow-sm transition-all"
                >
                  <div className={`h-16 bg-gradient-to-br ${accentRibbon[accent]}`} />

                  <div className="relative -mt-8 px-5 pb-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="relative">
                        <div className="relative size-14 overflow-hidden rounded-xl border-[3px] border-surface bg-canvas">
                          {av ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={av} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                              <ImageIcon className="size-5" />
                            </div>
                          )}
                          {avatarUploading === c.id ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Spinner className="size-4 border-t-primary" />
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-10 flex items-center gap-1.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-foreground hover:text-background"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="size-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          onClick={() => void removeCharacter(c)}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <h3 className="text-[15px] font-bold tracking-tight">{c.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground-muted">
                        {c.source_episode_id
                          ? `From Import`
                          : "Added manually"}
                        {c.role ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            {c.role}
                          </span>
                        ) : null}
                      </div>
                      {c.wardrobe_notes ? (
                        <p className="mt-1.5 text-[12px] text-foreground-muted line-clamp-2">{c.wardrobe_notes}</p>
                      ) : null}
                    </div>

                    <div className="mt-4 rounded-lg border border-border bg-canvas p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="label-eyebrow text-foreground-muted">Voice</span>
                        <span className={`text-[10px] font-semibold ${vstat === "Pending" ? "text-foreground-muted" : "text-primary"}`}>
                          {vstat}
                        </span>
                      </div>

                      {c.default_voice_id ? (
                        <>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                              disabled={previewLoadingId === c.id}
                              onClick={() => void playCurrentVoice(c)}
                              aria-label={`Play ${c.name} voice`}
                            >
                              {previewLoadingId === c.id ? (
                                <Spinner className="size-3.5 border-t-background" />
                              ) : (
                                <Play className="size-3.5 fill-current ml-0.5" />
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-semibold">
                                {c.voice_display_name || c.default_voice_id}
                              </div>
                              <VoiceWave
                                className="mt-1"
                                active={voicePreviewPlayingId === c.id}
                              />
                            </div>
                          </div>

                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <Link
                              href={`/voice-studio?character=${encodeURIComponent(c.id)}&panel=voice&tab=browse`}
                              className="flex-1 text-center rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] font-semibold text-foreground hover:bg-canvas transition-colors"
                            >
                              Change voice
                            </Link>
                            <button
                              type="button"
                              className="flex-1 text-center rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] font-semibold text-foreground hover:bg-canvas transition-colors"
                              onClick={() => void detachVoice(c)}
                            >
                              Remove voice
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[12px] text-foreground-muted">
                            No voice attached yet.
                          </p>
                          <Link
                            href={`/voice-studio?character=${encodeURIComponent(c.id)}&panel=voice&focus=attach`}
                            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90"
                          >
                            <Mic2 className="size-3.5" />
                            Attach a voice
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-muted transition-colors hover:text-foreground"
                        onClick={() => {
                          setAvatarTargetId(c.id);
                          fileRef.current?.click();
                        }}
                      >
                        <Camera className="size-3" />
                        Change photo
                      </button>
                      {c.sample_texts.length > 0 ? (
                        <span className="text-[10px] text-foreground-muted">
                          {Math.min(c.sample_texts.length, 4)} lines
                        </span>
                      ) : null}
                    </div>

                    {c.sample_texts.length > 0 ? (
                      <div className="mt-2.5 space-y-1.5 border-t border-border pt-3">
                        <span className="label-eyebrow text-foreground-muted">Sample lines</span>
                        {c.sample_texts.slice(0, 3).map((line, i) => (
                          <div
                            key={i}
                            className="flex gap-1.5 rounded-md bg-canvas px-2.5 py-1.5"
                          >
                            <Quote className="size-3 shrink-0 text-primary mt-0.5" />
                            <p className="text-[11.5px] leading-relaxed text-foreground-muted line-clamp-2">
                              {line}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      <ConfirmModal
        open={!!confirmRemoveChar}
        title="Remove character"
        confirmLabel="Remove"
        danger
        onConfirm={() => void executeRemoveCharacter()}
        onCancel={() => setConfirmRemoveChar(null)}
      >
        <p>
          Remove &ldquo;{confirmRemoveChar?.name}&rdquo; from this project?
          Saved clips for this character will be deleted.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={!!confirmDetachVoice}
        title="Remove voice"
        confirmLabel="Remove voice"
        onConfirm={() => void executeDetachVoice()}
        onCancel={() => setConfirmDetachVoice(null)}
      >
        <p>
          Remove the attached voice from &ldquo;{confirmDetachVoice?.name}&rdquo;?
          You can pick another in Voice Studio.
        </p>
      </ConfirmModal>

        </div>
      </div>
    </div>
  );
}
