"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Circle, Pencil, Trash2, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto, EpisodeDto, ProjectDto } from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/buttonStyles";
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
  const [project, setProject] = useState(initialProject);
  const episodes = initialEpisodes;
  const characters = initialCharacters;

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const charCount = characters.length;
  const voiced = characters.filter((c) => c.default_voice_id).length;
  const importedEpisodes = episodes.filter((e) => e.segment_count > 0).length;
  const hasSegments = episodes.some((e) => e.segment_count > 0);
  const hasReplacementReady = voiced > 0 && hasSegments;
  const hasImportedTranscript = importedEpisodes > 0;
  const allVoiced =
    charCount > 0 && characters.every((c) => Boolean(c.default_voice_id));
  const hasFootageOrRoster = hasImportedTranscript || charCount > 0;
  const castConfirmed = !hasImportedTranscript || charCount > 0;

  const checklist = useMemo(
    () => [
      {
        id: "footage",
        label: "Import video or add characters manually",
        done: hasFootageOrRoster,
        href: "/upload-match",
      },
      {
        id: "cast",
        label: "Review detected cast and create characters",
        done: castConfirmed,
        href: "/upload-match",
      },
      {
        id: "voice",
        label: "Attach or design voices in Voice Studio",
        done: charCount > 0 && allVoiced,
        href: "/voice-studio",
      },
      {
        id: "replace",
        label: "Replace lines with new performances",
        done: hasReplacementReady,
        href: "/replace-lines",
      },
    ],
    [hasFootageOrRoster, castConfirmed, charCount, allVoiced, hasReplacementReady],
  );

  const nextItem = checklist.find((c) => !c.done);

  const nextSummary = useMemo(() => {
    if (!nextItem) {
      return {
        title: "Production loop ready",
        body: "Swap lines, iterate clips, and refine performances from here.",
      };
    }
    if (nextItem.id === "footage") {
      return {
        title: "Choose how you start",
        body:
          "Import a clip to detect speakers and lines, or add characters by hand on the Characters page.",
      };
    }
    if (nextItem.id === "cast") {
      return {
        title: "Confirm your detected cast",
        body:
          "Name each detected voice, merge duplicates if needed, and create characters for your roster.",
      };
    }
    if (nextItem.id === "voice") {
      return {
        title: "Give your cast voices",
        body: `${Math.max(0, charCount - voiced)} character(s) still need a voice. Open Voice Studio to assign or design.`,
      };
    }
    return {
      title: "Final pass: replace lines",
      body: "Pick a line, pick a character with a voice, and generate new audio.",
    };
  }, [nextItem, charCount, voiced]);

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
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function removeProject() {
    if (
      !globalThis.confirm(
        "Delete this project and all of its characters, episodes, and metadata on this machine?",
      )
    ) {
      return;
    }
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

      {nextItem ? (
        <div className="rounded-2xl border border-accent/30 bg-accent/10 px-5 py-4 ring-1 ring-accent/20">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            Next step
          </p>
          <p className="mt-1 text-base font-semibold text-text">{nextSummary.title}</p>
          <p className="mt-1 text-sm text-muted">{nextSummary.body}</p>
          <Link
            href={nextItem.href}
            className={`${buttonClass("primary", "mt-4 inline-flex px-4")}`}
            onClick={() => setActiveProjectId(project.id)}
          >
            {nextItem.label}
          </Link>
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
          Import, build cast, attach voices, then replace lines. Completed steps
          stay marked below.
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
            Core workflow complete. Keep iterating in Replace Lines and Voice
            Studio.
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
              Imported episodes
            </p>
            <p className="mt-1 text-2xl font-semibold text-text">
              {episodes.length}
            </p>
            <p className="mt-0.5 text-[10px] text-muted">
              {importedEpisodes} with transcript
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06] transition hover:ring-white/10">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Replace lines
            </p>
            <p className="mt-1 text-sm font-medium text-text">
              {hasReplacementReady ? "Ready" : "Needs voice and transcript"}
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
            className={buttonClass("secondary", "px-4")}
            onClick={() => setActiveProjectId(project.id)}
          >
            Replace Lines
          </Link>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Episodes</h2>
          <span className="text-xs text-muted">{episodes.length} total</span>
        </div>
        {episodes.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No episodes yet. Use{" "}
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
          <ul className="mt-4 divide-y divide-white/[0.06]">
            {episodes.map((ep) => (
              <li
                key={ep.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0"
              >
                <div>
                  <p className="text-sm font-medium text-text">{ep.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {ep.segment_count} segments · updated{" "}
                    {formatUpdated(ep.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{ep.status}</Badge>
                  <Link
                    href="/replace-lines"
                    className={buttonClass("outline", "px-3 py-1.5 text-xs")}
                    onClick={() => setActiveProjectId(project.id)}
                  >
                    Replace Lines
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
