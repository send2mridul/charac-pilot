"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Circle,
  Clapperboard,
  Pencil,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  EpisodeDto,
  ProjectDto,
  ReplacementDto,
  VoiceClipDto,
} from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { useToast } from "@/components/providers/ToastProvider";
import {
  playVoicePreview,
  stopVoicePreview,
} from "@/lib/audio/voicePreviewPlayer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/buttonStyles";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Spinner } from "@/components/ui/Spinner";

/** Same output on server and client (avoids hydration mismatch from toLocaleString). */
function formatUpdated(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  } catch {
    return iso;
  }
}

type Props = {
  initialProject: ProjectDto;
  initialEpisodes: EpisodeDto[];
  initialCharacters: CharacterDto[];
};

export function ProjectDetailView({
  initialProject,
  initialEpisodes,
  initialCharacters,
}: Props) {
  const router = useRouter();
  const { refresh, setActiveProjectId } = useProjects();
  const toast = useToast();
  const [project, setProject] = useState(initialProject);
  const episodes = initialEpisodes;
  const characters = initialCharacters;
  const [replacements, setReplacements] = useState<ReplacementDto[]>([]);
  const [voiceClips, setVoiceClips] = useState<VoiceClipDto[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRemoveEp, setConfirmRemoveEp] = useState<EpisodeDto | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);

  useEffect(() => {
    return () => stopVoicePreview();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .listProjectReplacements(project.id)
      .then((rows) => {
        if (!cancelled) setReplacements(rows);
      })
      .catch(() => {
        if (!cancelled) setReplacements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    void api
      .listProjectClips(project.id)
      .then((rows) => {
        if (!cancelled) setVoiceClips(rows);
      })
      .catch(() => {
        if (!cancelled) setVoiceClips([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const charCount = characters.length;
  const voiced = characters.filter((c) => c.default_voice_id).length;
  const importedEpisodes = episodes.filter((e) => e.segment_count > 0).length;
  const hasSegments = episodes.some((e) => e.segment_count > 0);
  const hasImportedTranscript = importedEpisodes > 0;
  const replacementCount = replacements.length;
  const transcriptLineTotal = episodes.reduce((acc, e) => acc + (e.segment_count ?? 0), 0);
  const clipCount = voiceClips.length;
  const sortedEpisodes = useMemo(
    () =>
      [...episodes].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [episodes],
  );
  const recentReplacements = useMemo(
    () =>
      [...replacements]
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        .slice(0, 8),
    [replacements],
  );
  const hasReplacementReady = voiced > 0 && hasSegments;
  const workflowStarted = hasImportedTranscript || charCount > 0;
  const replaceStepDone =
    replacementCount > 0 ||
    (!hasImportedTranscript && voiced > 0 && charCount > 0);

  const checklist = useMemo(
    () => [
      {
        id: "start",
        label: "Start: import video or add a character",
        done: workflowStarted,
        href: "/upload-match",
      },
      {
        id: "cast",
        label: "Characters: confirm your project roster",
        done: charCount > 0,
        href: "/characters",
      },
      {
        id: "voice",
        label: "Voice Studio: attach or design voices",
        done: voiced > 0,
        href: "/voice-studio",
      },
      {
        id: "replace",
        label:
          "Replace Lines (optional): advanced history, bulk tools, and precision edits",
        done: replaceStepDone,
        href: "/replace-lines",
      },
    ],
    [workflowStarted, charCount, voiced, replaceStepDone],
  );

  const nextItem = checklist.find((c) => !c.done);

  const nextSummary = useMemo(() => {
    if (!nextItem) {
      return {
        title: "Core workflow is in good shape",
        body: "Keep refining voices, clips, and line audio from here.",
      };
    }
    if (nextItem.id === "start") {
      return {
        title: "Pick how you want to begin",
        body:
          "Import video to get transcript lines and detected cast, or add characters manually and go straight to Voice Studio.",
      };
    }
    if (nextItem.id === "cast") {
      return {
        title: "Add people to your roster",
        body:
          "Detected cast from video are candidates only. Confirm them as Characters, or add roles manually.",
      };
    }
    if (nextItem.id === "voice") {
      return {
        title: "Give your roster voices",
        body:
          charCount === 0
            ? "Add at least one character, then attach or design a voice in Voice Studio."
            : `${Math.max(0, charCount - voiced)} character(s) still need a voice.`,
      };
    }
    return {
      title: "Line audio and rewrites",
      body: hasImportedTranscript
        ? "Use Import from Video as the main line editor (save text, generate audio). Replace Lines adds history, bulk tools, and deep edits."
        : "Replace Lines opens when you have an import with transcript lines. For manual projects, Voice Studio clips are your main line audio.",
    };
  }, [nextItem, charCount, voiced, hasImportedTranscript]);

  async function saveProject() {
    setSaving(true);
    setErr(null);
    try {
      const p = await api.patchProject(project.id, {
        name: editName.trim(),
        description: editDesc.trim(),
      });
      setProject(p);
      setEditOpen(false);
      await refresh();
      toast("Project saved");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function removeEpisodeImport(ep: EpisodeDto) {
    setConfirmRemoveEp(ep);
  }

  async function executeRemoveEpisodeImport() {
    const ep = confirmRemoveEp;
    if (!ep) return;
    setConfirmRemoveEp(null);
    setErr(null);
    try {
      await api.deleteEpisode(ep.id);
      toast("Import removed from this project");
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove import");
    }
  }

  function removeProject() {
    setConfirmDeleteProject(true);
  }

  async function executeRemoveProject() {
    setConfirmDeleteProject(false);
    setDeleting(true);
    setErr(null);
    try {
      await api.deleteProject(project.id);
      await refresh();
      router.push("/projects");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-10">
      <Link
        href="/projects"
        className={buttonClass("ghost", "inline-flex w-fit justify-start px-2")}
      >
        <span className="text-base leading-none" aria-hidden>
          ←
        </span>
        All projects
      </Link>

      <PageHeader
        title={project.name}
        subtitle={
          (project.description || "").trim()
            ? `${(project.description || "").trim()} · Updated ${formatUpdated(project.updated_at)}`
            : `Updated ${formatUpdated(project.updated_at)}`
        }
        actions={
          <>
            <Badge tone="success">{project.status}</Badge>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setEditName(project.name);
                setEditDesc(project.description ?? "");
                setEditOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
              Edit project
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={deleting}
              onClick={() => void removeProject()}
            >
              {deleting ? (
                <Spinner className="h-4 w-4 border-t-text" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          </>
        }
      />

      {err ? <ErrorBanner title="Project" detail={err} /> : null}

      <Panel>
        <h2 className="text-sm font-semibold text-text">Choose a path</h2>
        <p className="mt-1 text-sm text-muted">
          Import video to get transcript lines and detected cast candidates, or build your roster by hand and go straight to voices and clips.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Link
            href="/upload-match"
            className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/[0.08] transition hover:bg-white/[0.06] hover:ring-accent/30"
            onClick={() => setActiveProjectId(project.id)}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">
              Video first
            </p>
            <p className="mt-2 text-base font-semibold text-text">Import from Video</p>
            <p className="mt-1 text-sm text-muted">
              Transcript, detected cast, thumbnails. Analysis saves to this project when it finishes.
            </p>
          </Link>
          <Link
            href="/characters"
            className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/[0.08] transition hover:bg-white/[0.06] hover:ring-accent/30"
            onClick={() => setActiveProjectId(project.id)}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">
              No video yet
            </p>
            <p className="mt-2 text-base font-semibold text-text">Add Character Manually</p>
            <p className="mt-1 text-sm text-muted">
              Create your roster, then open Voice Studio to attach or design voices and generate clips.
            </p>
          </Link>
        </div>
      </Panel>

      {nextItem ? (
        <div className="rounded-2xl border border-accent/30 bg-accent/10 px-5 py-4 ring-1 ring-accent/20">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            Next step
          </p>
          <p className="mt-1 text-base font-semibold text-text">{nextSummary.title}</p>
          <p className="mt-1 text-sm text-muted">{nextSummary.body}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={nextItem.href}
              className={buttonClass("primary", "inline-flex px-4")}
              onClick={() => setActiveProjectId(project.id)}
            >
              {nextItem.id === "start"
                ? "Open Import from Video"
                : nextItem.label}
            </Link>
            {nextItem.id === "start" ? (
              <Link
                href="/characters"
                className={buttonClass("secondary", "inline-flex px-4")}
                onClick={() => setActiveProjectId(project.id)}
              >
                Add Character Manually
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-4 ring-1 ring-emerald-500/20">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
            On track
          </p>
          <p className="mt-1 text-base font-semibold text-text">{nextSummary.title}</p>
          <p className="mt-1 text-sm text-muted">{nextSummary.body}</p>
        </div>
      )}

      {editOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-project-title"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-panel p-6 ring-1 ring-white/10">
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg p-1 text-muted transition hover:bg-white/[0.06] hover:text-text"
              onClick={() => setEditOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 id="edit-project-title" className="text-lg font-semibold text-text">
              Edit project
            </h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted">Name</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted">
                  Description (optional)
                </label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40"
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="What is this production about?"
                />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving || !editName.trim()}
                onClick={() => void saveProject()}
              >
                {saving ? <Spinner className="h-4 w-4 border-t-canvas" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Panel>
        <h2 className="text-sm font-semibold text-text">Production checklist</h2>
        <p className="mt-1 text-sm text-muted">
          Detected cast and transcript lines live on Import from Video. Characters are confirmed roster entries. Voice Studio attaches voices. Replace Lines is an optional advanced tool for bulk work and line history.
        </p>
        <ul className="mt-4 space-y-2">
          {checklist.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                onClick={() => setActiveProjectId(project.id)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ring-1 ${
                  nextItem?.id === item.id
                    ? "bg-accent/10 ring-accent/35 text-text"
                    : "bg-white/[0.02] ring-white/[0.06] text-muted hover:bg-white/[0.04]"
                }`}
              >
                {item.done ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted" />
                )}
                <span className={item.done ? "line-through opacity-70" : ""}>
                  {item.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {nextItem ? (
          <p className="mt-4 text-sm text-text">
            <span className="font-medium">Still to do: </span>
            <Link
              href={nextItem.href}
              className="text-accent underline-offset-4 hover:underline"
              onClick={() => setActiveProjectId(project.id)}
            >
              {nextItem.label}
            </Link>
          </p>
        ) : (
          <p className="mt-4 text-sm text-emerald-400/90">
            Core workflow complete. Keep iterating in Import from Video, Voice Studio, and Replace Lines when you need advanced tools.
          </p>
        )}
      </Panel>

      <Panel>
        <h2 className="text-sm font-semibold text-text">Overview</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06] transition hover:ring-white/10">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Characters
            </p>
            <p className="mt-1 text-2xl font-semibold text-text">{charCount}</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06] transition hover:ring-white/10">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Voices assigned
            </p>
            <p className="mt-1 text-2xl font-semibold text-text">
              {charCount ? `${voiced}/${charCount}` : "0"}
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06] transition hover:ring-white/10">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Imports & transcript
            </p>
            <p className="mt-1 text-2xl font-semibold text-text">
              {importedEpisodes}/{episodes.length}
            </p>
            <p className="mt-0.5 text-[10px] text-muted">
              {transcriptLineTotal} transcript line{transcriptLineTotal === 1 ? "" : "s"} total
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06] transition hover:ring-white/10">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Line audio & clips
            </p>
            <p className="mt-1 text-sm font-medium text-text">
              {replacementCount > 0
                ? `${replacementCount} saved line${replacementCount === 1 ? "" : "s"}`
                : hasReplacementReady
                  ? "No saved lines yet"
                  : "Needs voice + import"}
            </p>
            <p className="mt-0.5 text-[10px] text-muted">
              {clipCount} voice clip{clipCount === 1 ? "" : "s"} in Voice Studio
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/upload-match"
            className={buttonClass("primary", "px-4")}
            onClick={() => setActiveProjectId(project.id)}
          >
            Import from Video
          </Link>
          <Link
            href="/characters"
            className={buttonClass("secondary", "px-4")}
            onClick={() => setActiveProjectId(project.id)}
          >
            Characters
          </Link>
          <Link
            href="/voice-studio"
            className={buttonClass("secondary", "px-4")}
            onClick={() => setActiveProjectId(project.id)}
          >
            Voice Studio
          </Link>
          <Link
            href="/replace-lines"
            className={
              hasReplacementReady
                ? buttonClass("secondary", "px-4")
                : buttonClass("ghost", "px-4 text-muted-foreground")
            }
            onClick={() => setActiveProjectId(project.id)}
          >
            Replace Lines
          </Link>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Saved line takes</h2>
          <span className="text-xs text-muted">{replacements.length} total</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Saved line audio from Import from Video or Replace Lines. Open the import workspace to jump straight to a line.
        </p>
        {replacements.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            None yet. Open{" "}
            <Link
              href="/upload-match"
              className="font-medium text-accent hover:underline"
              onClick={() => setActiveProjectId(project.id)}
            >
              Import from Video
            </Link>{" "}
            to generate from the transcript, or use{" "}
            <Link
              href="/replace-lines"
              className="font-medium text-accent hover:underline"
              onClick={() => setActiveProjectId(project.id)}
            >
              Replace Lines
            </Link>{" "}
            for advanced edits.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-white/[0.06]">
            {recentReplacements.map((r) => (
              <li
                key={r.replacement_id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    {formatUpdated(r.updated_at)}
                  </p>
                  <p className="text-sm font-medium text-text">{r.character_name}</p>
                  {r.original_text ? (
                    <p className="mt-0.5 line-clamp-1 text-[11px] italic text-muted">
                      Original: {r.original_text}
                    </p>
                  ) : null}
                  <p className="mt-0.5 line-clamp-2 text-xs text-foreground">
                    {r.replacement_text}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={buttonClass("outline", "inline-flex items-center gap-1 px-2.5 py-1 text-xs")}
                    onClick={() => {
                      const url = mediaUrl(r.audio_url.replace(/^\/media\//, ""));
                      void playVoicePreview(url);
                    }}
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    Play
                  </button>
                  <Link
                    href={`/upload-match?episode=${encodeURIComponent(r.episode_id)}`}
                    className={buttonClass("primary", "px-2.5 py-1 text-xs")}
                    onClick={() => setActiveProjectId(project.id)}
                  >
                    Open workspace
                  </Link>
                  <Link
                    href={`/replace-lines?episode=${encodeURIComponent(r.episode_id)}&segment=${encodeURIComponent(r.segment_id)}`}
                    className={buttonClass("secondary", "px-2.5 py-1 text-xs")}
                    onClick={() => setActiveProjectId(project.id)}
                  >
                    Advanced
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        {replacements.length > recentReplacements.length ? (
          <p className="mt-2 text-xs text-muted">
            Showing {recentReplacements.length} most recent. Open Replace Lines to browse the full list.
          </p>
        ) : null}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Imports & media</h2>
            <p className="mt-1 text-sm text-muted">
              Each upload is an episode with transcript, cast, and frames. Open the import workspace to continue editing where you left off.
            </p>
          </div>
          <span className="text-xs text-muted">{episodes.length} file{episodes.length === 1 ? "" : "s"}</span>
        </div>
        {episodes.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No imports yet. Use{" "}
            <Link
              href="/upload-match"
              className="font-medium text-accent hover:underline"
              onClick={() => setActiveProjectId(project.id)}
            >
              Import from Video
            </Link>{" "}
            to upload a file and build a transcript.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {sortedEpisodes.map((ep) => {
              const thumb = ep.thumbnail_paths?.[0];
              const rosterForEp = characters.filter((c) => c.source_episode_id === ep.id).length;
              const displayTitle =
                ep.title?.trim() ||
                (ep.source_video_path ? ep.source_video_path.split(/[/\\]/).pop() : "") ||
                ep.id.slice(0, 8);
              return (
                <li
                  key={ep.id}
                  className="flex flex-wrap items-stretch gap-4 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.08]"
                >
                  <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]">
                    {thumb ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={mediaUrl(thumb)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted">
                        <Clapperboard className="h-8 w-8 opacity-40" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text">{displayTitle}</p>
                    <p className="mt-1 text-xs text-muted">
                      {ep.segment_count} transcript lines
                      {ep.duration_sec != null ? ` · ${Math.round(ep.duration_sec)}s` : ""}
                      {rosterForEp > 0 ? ` · ${rosterForEp} roster link${rosterForEp === 1 ? "" : "s"}` : ""}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted">
                      Updated {formatUpdated(ep.updated_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col justify-center gap-2 sm:flex-row sm:items-center">
                    <Badge tone="accent">{ep.status}</Badge>
                    <Link
                      href={`/upload-match?episode=${encodeURIComponent(ep.id)}`}
                      className={buttonClass("primary", "inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs")}
                      onClick={() => setActiveProjectId(project.id)}
                    >
                      <Clapperboard className="h-3.5 w-3.5" />
                      Open workspace
                    </Link>
                    <Link
                      href={`/replace-lines?episode=${encodeURIComponent(ep.id)}`}
                      className={buttonClass("secondary", "px-3 py-2 text-xs")}
                      onClick={() => setActiveProjectId(project.id)}
                    >
                      Replace Lines
                    </Link>
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-2.5 !py-2 !text-xs text-red-600 dark:text-red-400"
                      onClick={() => void removeEpisodeImport(ep)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <ConfirmModal
        open={!!confirmRemoveEp}
        title="Remove import"
        confirmLabel="Remove"
        danger
        onConfirm={() => void executeRemoveEpisodeImport()}
        onCancel={() => setConfirmRemoveEp(null)}
      >
        <p>
          Remove &ldquo;{confirmRemoveEp?.title}&rdquo; from the project? Its
          transcript and detected cast data will be deleted from this machine.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={confirmDeleteProject}
        title="Delete project"
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={() => void executeRemoveProject()}
        onCancel={() => setConfirmDeleteProject(false)}
      >
        <p>
          Delete this project and all of its characters, episodes, and metadata
          on this machine?
        </p>
      </ConfirmModal>
    </div>
  );
}
