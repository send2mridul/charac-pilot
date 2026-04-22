"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Camera,
  ChevronDown,
  ExternalLink,
  ImageIcon,
  Mic2,
  Pencil,
  Play,
  Plus,
  Quote,
  Repeat,
  Sparkles,
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
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-6 pb-2">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {characters.length} character{characters.length === 1 ? "" : "s"} in roster
          </span>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-balance text-foreground md:text-6xl">
            Characters
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Build your cast here or from Import from Video. Then attach voices, generate clips, and finish in Replace Lines.
          </p>
        </div>
        <Link
          href="/upload-match"
          className={buttonClass(
            "secondary",
            "inline-flex h-12 items-center gap-2 rounded-xl border-border-strong bg-surface px-5 text-sm font-semibold shadow-soft hover:border-foreground hover:bg-foreground hover:text-background",
          )}
        >
          <Upload className="h-4 w-4" />
          Import from Video
        </Link>
      </div>

      <section className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-soft">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-warm px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Project
            </span>
            <div className="relative">
              <select
                className="group flex cursor-pointer appearance-none items-center gap-2 rounded-xl border border-border bg-surface py-1.5 pl-3 pr-9 text-sm font-semibold text-foreground outline-none transition-colors hover:border-foreground/40"
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
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                <ChevronDown className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            <Sparkles className="h-3 w-3 text-primary" />
            Auto-detect speakers
          </div>
        </div>

        {activeProjectId && !projectsLoading ? (
          <div className="relative px-6 py-6">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
                  Add a character
                </h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Manual entry is always available. Import from Video can also create characters from detected speakers.
                </p>
              </div>
            </div>
            <form onSubmit={(e) => void handleAddCharacter(e)} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Name
                </label>
                <input
                  className="h-11 w-full rounded-xl border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. Mara Voss"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Role <span className="text-muted-foreground/60">(optional)</span>
                  </label>
                  <input
                    className="h-11 w-full rounded-xl border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20"
                    placeholder="Lead, narrator, guestâ€¦"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Notes <span className="text-muted-foreground/60">(optional)</span>
                  </label>
                  <input
                    className="h-11 w-full rounded-xl border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20"
                    placeholder="Wardrobe, mannerisms, context"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-[11px] text-muted-foreground">
                  Tip: add a photo and short bio after creating to improve voice matching.
                </p>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="group inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-teal px-5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-95 disabled:opacity-50"
                >
                  {creating ? (
                    <Spinner className="h-4 w-4 border-t-primary-foreground" />
                  ) : (
                    <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
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
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-lifted">
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
              onClick={() => setEditId(null)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="font-display text-lg font-semibold text-foreground">Edit character</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Name</label>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Role</label>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Notes</label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
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
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-soft">
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-soft">
            <Skeleton className="h-32 w-full" />
          </div>
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
          <div className="mt-12 flex items-end justify-between pb-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Roster
              </div>
              <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">
                Your cast
              </h2>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">{characters.length}</span> total Â·{" "}
              <span className="font-mono font-semibold text-foreground">{voicedCount}</span> voices designed
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {characters.map((c, idx) => {
              const av = avatarSrc(c);
              const accent = accentForIndex(idx);
              const vstat = voiceStatus(c);
              return (
                <article
                  key={c.id}
                  className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elegant"
                >
                  <div className={`h-24 bg-gradient-to-br ${accentRibbon[accent]}`} />

                  <div className="relative -mt-14 px-6 pb-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="relative">
                        <div className="relative h-20 w-20 overflow-hidden rounded-2xl border-4 border-surface bg-surface-sunken shadow-elegant">
                          {av ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={av} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageIcon className="h-7 w-7" />
                            </div>
                          )}
                          {avatarUploading === c.id ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Spinner className="h-5 w-5 border-t-primary" />
                            </div>
                          ) : null}
                        </div>
                        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-primary text-[10px] font-bold text-primary-foreground shadow-soft">
                          {c.name[0]?.toUpperCase() ?? "?"}
                        </span>
                      </div>

                      <div className="mt-14 flex flex-col items-end gap-1.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline dark:text-red-400"
                          onClick={() => void removeCharacter(c)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="mt-4">
                      <h3 className="font-display text-2xl font-semibold leading-none tracking-tight text-foreground">
                        {c.name}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                          {c.source_episode_id
                            ? `From Import Â· ${episodeTitleById[c.source_episode_id] ?? "episode"}`
                            : "Added manually"}
                        </span>
                        {c.source_speaker_labels.length > 0 ? (
                          <span className="text-[10px] opacity-80">
                            Voice label: {c.source_speaker_labels.join(", ")}
                          </span>
                        ) : null}
                        {c.role ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            {c.role}
                          </span>
                        ) : null}
                      </div>
                      {c.wardrobe_notes ? (
                        <p className="mt-2 text-[13px] italic text-muted-foreground">{c.wardrobe_notes}</p>
                      ) : null}
                    </div>

                    <div className="mt-5 rounded-2xl border border-border bg-surface-sunken p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Voice
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          {vstat}
                        </span>
                      </div>

                      {c.default_voice_id ? (
                        <>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-teal text-primary-foreground shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                              disabled={previewLoadingId === c.id}
                              onClick={() => void playCurrentVoice(c)}
                              aria-label={`Play ${c.name} voice`}
                            >
                              {previewLoadingId === c.id ? (
                                <Spinner className="h-4 w-4 border-t-primary-foreground" />
                              ) : (
                                <Play className="h-4 w-4 fill-current" />
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-foreground">
                                {c.voice_display_name || c.default_voice_id}
                              </div>
                              <VoiceWave
                                className="mt-1.5"
                                active={voicePreviewPlayingId === c.id}
                              />
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              href={`/voice-studio?character=${encodeURIComponent(c.id)}&panel=voice&tab=browse`}
                              className={buttonClass(
                                "outline",
                                "flex min-w-[120px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs",
                              )}
                            >
                              <Repeat className="h-3 w-3" />
                              Change voice
                            </Link>
                            <Button
                              type="button"
                              variant="secondary"
                              className="flex min-w-[120px] flex-1 items-center justify-center gap-1.5 !px-3 !py-2 !text-xs"
                              onClick={() => void detachVoice(c)}
                            >
                              Remove voice
                            </Button>
                            <Link
                              href="/voice-studio"
                              className={buttonClass(
                                "outline",
                                "flex min-w-[120px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs",
                              )}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Voice Studio
                            </Link>
                            <Link
                              href={`/voice-studio?character=${encodeURIComponent(c.id)}&panel=clips`}
                              className={buttonClass(
                                "outline",
                                "flex min-w-[120px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs",
                              )}
                            >
                              <Sparkles className="h-3 w-3" />
                              Generate clips
                            </Link>
                            {c.source_episode_id || c.segment_count > 0 ? (
                              <Link
                                href={
                                  c.source_episode_id
                                    ? `/replace-lines?episode=${encodeURIComponent(c.source_episode_id)}`
                                    : "/replace-lines"
                                }
                                className={buttonClass(
                                  "outline",
                                  "flex min-w-[120px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs",
                                )}
                              >
                                <Quote className="h-3 w-3" />
                                Replace lines
                              </Link>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            No voice attached yet. This character is on the roster
                            but still needs a voice.
                          </p>
                          <Link
                            href={`/voice-studio?character=${encodeURIComponent(c.id)}&panel=voice&focus=attach`}
                            className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-teal px-4 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-95"
                          >
                            <Mic2 className="h-4 w-4" />
                            Attach a voice
                          </Link>
                          <Link
                            href={`/voice-studio?character=${encodeURIComponent(c.id)}&panel=voice&focus=attach`}
                            className="block text-center text-[11px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          >
                            Open in Voice Studio
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => {
                          setAvatarTargetId(c.id);
                          fileRef.current?.click();
                        }}
                      >
                        <Camera className="h-3.5 w-3.5" />
                        Change photo
                      </button>
                      {c.sample_texts.length > 0 ? (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {Math.min(c.sample_texts.length, 4)} import lines
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-2 border-t border-border pt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Import transcript (source lines from footage)
                      </p>
                      {c.sample_texts.length > 0 ? (
                        c.sample_texts.slice(0, 4).map((line, i) => (
                          <div
                            key={i}
                            className="flex gap-2 rounded-xl bg-surface-sunken/60 px-3 py-2"
                          >
                            <Quote className="h-3 w-3 shrink-0 text-primary" />
                            <p className="text-[12px] italic leading-relaxed text-muted-foreground">
                              {line}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          {c.source_episode_id
                            ? "No lines matched this character on the import yet."
                            : "Manual characters only show import lines after you link them to footage, or use Voice Studio for spoken clips."}
                        </p>
                      )}
                    </div>
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

      <footer className="mt-16 border-t border-border pt-6 text-center text-[11px] text-muted-foreground">
        CastWeave Â· Video to cast, voice, and lines.
      </footer>
    </div>
  );
}
