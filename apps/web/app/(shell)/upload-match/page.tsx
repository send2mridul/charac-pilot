"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  EyeOff,
  FileText,
  FileVideo,
  GitMerge,
  Mic2,
  Pencil,
  UploadCloud,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  EpisodeMediaJobResult,
  JobDto,
  SpeakerGroupDto,
  TranscriptSegmentDto,
} from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";

/** Polling interval while job.status is queued or running. */
const JOB_POLL_INTERVAL_MS = 400;
/** Safety cap so the UI never polls forever if the job never reaches a terminal status. */
const JOB_POLL_MAX_MS = 45 * 60 * 1000;

function normalizeJobStatus(status: unknown): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function mediaResultFromJob(job: JobDto | null): EpisodeMediaJobResult | null {
  if (!job?.result || typeof job.result !== "object") return null;
  const r = job.result as Record<string, unknown>;
  if (typeof r.episode_id !== "string" || typeof r.project_id !== "string")
    return null;
  if (typeof r.source_video_path !== "string") return null;
  if (typeof r.extracted_audio_path !== "string") return null;
  if (!Array.isArray(r.thumbnail_paths)) return null;
  return {
    episode_id: r.episode_id.trim(),
    project_id: r.project_id.trim(),
    source_video_path: r.source_video_path,
    extracted_audio_path: r.extracted_audio_path,
    thumbnail_paths: r.thumbnail_paths as string[],
    duration_sec:
      typeof r.duration_sec === "number" ? r.duration_sec : undefined,
    transcript_segment_count:
      typeof r.transcript_segment_count === "number"
        ? r.transcript_segment_count
        : undefined,
    transcript_language:
      typeof r.transcript_language === "string"
        ? r.transcript_language
        : undefined,
    speaker_count:
      typeof r.speaker_count === "number" ? r.speaker_count : undefined,
    import_provider:
      typeof r.import_provider === "string" ? r.import_provider : undefined,
    fallback_reason:
      typeof r.fallback_reason === "string"
        ? r.fallback_reason
        : r.fallback_reason === null
          ? null
          : undefined,
  };
}

/** Episode id for transcript API: prefer full media result, else raw job.result (trimmed). */
function resolveEpisodeIdForTranscript(
  job: JobDto | null,
  media: EpisodeMediaJobResult | null,
): string | null {
  const fromMedia = media?.episode_id?.trim();
  if (fromMedia) return fromMedia;
  if (normalizeJobStatus(job?.status) !== "done" || !job.result || typeof job.result !== "object") {
    return null;
  }
  const eid = (job.result as Record<string, unknown>).episode_id;
  return typeof eid === "string" ? eid.trim() : null;
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const sec = r < 10 ? `0${r.toFixed(2)}` : r.toFixed(2);
  return `${m}:${sec}`;
}

function speakerRowDomId(label: string): string {
  return `spk-${label.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

type Phase = "idle" | "uploading" | "processing" | "done" | "failed";
type PersistedImportContext = {
  media: EpisodeMediaJobResult;
};

export default function UploadMatchPage() {
  const { activeProjectId, projects, setActiveProjectId, loading: boot } =
    useProjects();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadRatio, setUploadRatio] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<JobDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistedMedia, setPersistedMedia] = useState<EpisodeMediaJobResult | null>(
    null,
  );
  const [transcriptSegments, setTranscriptSegments] = useState<
    TranscriptSegmentDto[]
  >([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptFetchDone, setTranscriptFetchDone] = useState(false);
  const [speakerGroups, setSpeakerGroups] = useState<SpeakerGroupDto[]>([]);
  const [speakerGroupsLoading, setSpeakerGroupsLoading] = useState(false);
  const [speakerGroupsError, setSpeakerGroupsError] = useState<string | null>(
    null,
  );
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [createdChars, setCreatedChars] = useState<Record<string, CharacterDto>>(
    {},
  );
  const [creatingLabel, setCreatingLabel] = useState<string | null>(null);
  const [charNameInput, setCharNameInput] = useState("");
  const [charCreateError, setCharCreateError] = useState<string | null>(null);
  const [selectedTranscriptSegmentId, setSelectedTranscriptSegmentId] =
    useState<string | null>(null);
  const [ignoredLabels, setIgnoredLabels] = useState<Set<string>>(new Set());
  const [mergeBusy, setMergeBusy] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [mergeTargetFor, setMergeTargetFor] = useState<Record<string, string>>(
    {},
  );

  const storageKey = activeProjectId
    ? `castvoice:import-context:${activeProjectId}`
    : null;

  const pollJob = useCallback(async (jobId: string, startedAt = Date.now()) => {
    try {
      const j = await api.getJob(jobId);
      setJob(j);
      const st = normalizeJobStatus(j.status);
      if (st === "queued" || st === "running") {
        if (Date.now() - startedAt > JOB_POLL_MAX_MS) {
          setPhase("failed");
          setError(
            "Timed out waiting for processing (job stayed queued or running). Check the API logs or try again.",
          );
          return;
        }
        window.setTimeout(
          () => void pollJob(jobId, startedAt),
          JOB_POLL_INTERVAL_MS,
        );
        return;
      }
      if (st === "failed") {
        setPhase("failed");
        return;
      }
      if (st === "done") {
        setPhase("done");
        return;
      }
      setPhase("failed");
      setError(
        `Unexpected job status from server: ${String(j.status ?? "").slice(0, 120)}`,
      );
    } catch (e) {
      setPhase("failed");
      setError(
        e instanceof ApiError ? e.message : "Could not load job status",
      );
    }
  }, []);

  async function startUpload() {
    if (!activeProjectId || !file) return;
    setBusy(true);
    setError(null);
    setJob(null);
    setPersistedMedia(null);
    setTranscriptSegments([]);
    setTranscriptError(null);
    setTranscriptFetchDone(false);
    setSpeakerGroups([]);
    setSpeakerGroupsError(null);
    setCreatedChars({});
    setCharCreateError(null);
    setSelectedTranscriptSegmentId(null);
    setBulkSelected(new Set());
    setMergeTargetFor({});
    setPhase("uploading");
    setUploadRatio(0);
    try {
      const res = await api.uploadEpisodeFile(
        activeProjectId,
        file,
        (r) => setUploadRatio(r),
      );
      setPhase("processing");
      await pollJob(res.job_id);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const mediaDone =
    persistedMedia ??
    (job && normalizeJobStatus(job.status) === "done"
      ? mediaResultFromJob(job)
      : null);
  const transcriptEpisodeId = resolveEpisodeIdForTranscript(job, mediaDone);

  const ignoredStorageKey = transcriptEpisodeId
    ? `castvoice:ignored-cast:${transcriptEpisodeId}`
    : null;

  useEffect(() => {
    setIgnoredLabels(new Set());
  }, [transcriptEpisodeId]);

  useEffect(() => {
    if (!ignoredStorageKey) return;
    try {
      const raw = window.localStorage.getItem(ignoredStorageKey);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return;
      setIgnoredLabels(new Set(arr.filter((x) => typeof x === "string")));
    } catch {
      /* ignore */
    }
  }, [ignoredStorageKey]);

  useEffect(() => {
    if (!ignoredStorageKey) return;
    try {
      window.localStorage.setItem(
        ignoredStorageKey,
        JSON.stringify([...ignoredLabels]),
      );
    } catch {
      /* ignore */
    }
  }, [ignoredStorageKey, ignoredLabels]);

  useEffect(() => {
    setPersistedMedia(null);
    setJob(null);
    setTranscriptSegments([]);
    setTranscriptError(null);
    setTranscriptFetchDone(false);
    setSpeakerGroups([]);
    setSpeakerGroupsError(null);
    setSelectedTranscriptSegmentId(null);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedImportContext;
      if (!parsed?.media?.episode_id) return;
      setPersistedMedia(parsed.media);
      setPhase("done");
    } catch {
      /* ignore invalid local data */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !mediaDone) return;
    const payload: PersistedImportContext = { media: mediaDone };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      /* ignore storage write errors */
    }
  }, [storageKey, mediaDone]);

  useEffect(() => {
    const ep = transcriptEpisodeId;
    if (!ep || phase !== "done") {
      return;
    }
    let cancelled = false;
    setTranscriptFetchDone(false);
    setTranscriptLoading(true);
    setTranscriptError(null);
    void api
      .listEpisodeTranscriptSegments(ep)
      .then((rows) => {
        if (!cancelled) setTranscriptSegments(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setTranscriptError(
            e instanceof ApiError ? e.message : "Could not load transcript",
          );
          setTranscriptSegments([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTranscriptLoading(false);
          setTranscriptFetchDone(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [transcriptEpisodeId, phase]);

  useEffect(() => {
    const ep = transcriptEpisodeId;
    if (!ep || phase !== "done" || !transcriptFetchDone) return;
    let cancelled = false;
    setSpeakerGroupsLoading(true);
    setSpeakerGroupsError(null);
    void api
      .listSpeakerGroups(ep)
      .then((rows) => {
        if (!cancelled) setSpeakerGroups(rows);
      })
      .catch((e) => {
        if (!cancelled)
          setSpeakerGroupsError(
            e instanceof ApiError ? e.message : "Could not load speaker groups",
          );
      })
      .finally(() => {
        if (!cancelled) setSpeakerGroupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transcriptEpisodeId, phase, transcriptFetchDone]);

  async function handleRename(label: string, displayName: string) {
    const ep = transcriptEpisodeId;
    if (!ep) return;
    try {
      const updated = await api.renameSpeakerGroup(ep, label, {
        display_name: displayName,
      });
      setSpeakerGroups((prev) =>
        prev.map((g) => (g.speaker_label === label ? updated : g)),
      );
    } catch (e) {
      setSpeakerGroupsError(
        e instanceof ApiError ? e.message : "Rename failed",
      );
    }
    setEditingLabel(null);
  }

  async function handleNarrator(label: string, isNarrator: boolean) {
    const ep = transcriptEpisodeId;
    if (!ep) return;
    try {
      const updated = await api.renameSpeakerGroup(ep, label, {
        is_narrator: isNarrator,
      });
      setSpeakerGroups((prev) =>
        prev.map((g) => (g.speaker_label === label ? updated : g)),
      );
    } catch (e) {
      setSpeakerGroupsError(
        e instanceof ApiError ? e.message : "Update failed",
      );
    }
  }

  async function handleCreateCharacter(label: string, name: string) {
    const ep = transcriptEpisodeId;
    if (!ep || !name.trim()) return;
    setCharCreateError(null);
    try {
      const c = await api.createCharacterFromGroup(ep, label, {
        name: name.trim(),
        project_id: activeProjectId || undefined,
      });
      setCreatedChars((prev) => ({ ...prev, [label]: c }));
    } catch (e) {
      setCharCreateError(
        e instanceof ApiError ? e.message : "Create character failed",
      );
    }
    setCreatingLabel(null);
  }

  async function runMerge(fromLabel: string, intoLabel: string) {
    const ep = transcriptEpisodeId;
    if (!ep || !fromLabel || !intoLabel || fromLabel === intoLabel) return;
    setMergeBusy(true);
    setSpeakerGroupsError(null);
    try {
      const newGroups = await api.mergeSpeakerGroups(ep, {
        from_label: fromLabel,
        into_label: intoLabel,
      });
      setSpeakerGroups(newGroups);
      const rows = await api.listEpisodeTranscriptSegments(ep);
      setTranscriptSegments(rows);
      setCreatedChars((prev) => {
        const next = { ...prev };
        const moved = next[fromLabel];
        if (moved) {
          delete next[fromLabel];
          next[intoLabel] = moved;
        }
        return next;
      });
      setIgnoredLabels((prev) => {
        const n = new Set(prev);
        n.delete(fromLabel);
        return n;
      });
      setBulkSelected((prev) => {
        const n = new Set(prev);
        n.delete(fromLabel);
        return n;
      });
      setMergeTargetFor((prev) => {
        const next = { ...prev };
        delete next[fromLabel];
        delete next[intoLabel];
        return next;
      });
    } catch (e) {
      setSpeakerGroupsError(
        e instanceof ApiError ? e.message : "Could not merge cast entries",
      );
    } finally {
      setMergeBusy(false);
    }
  }

  function toggleIgnore(label: string) {
    setIgnoredLabels((prev) => {
      const n = new Set(prev);
      if (n.has(label)) n.delete(label);
      else n.add(label);
      return n;
    });
    setBulkSelected((prev) => {
      const n = new Set(prev);
      n.delete(label);
      return n;
    });
  }

  function toggleBulkLabel(label: string) {
    if (createdChars[label]) return;
    setBulkSelected((prev) => {
      const n = new Set(prev);
      if (n.has(label)) n.delete(label);
      else n.add(label);
      return n;
    });
  }

  async function bulkCreateCharacters() {
    const ep = transcriptEpisodeId;
    if (!ep || bulkSelected.size === 0) return;
    setBulkBusy(true);
    setCharCreateError(null);
    try {
      for (const label of bulkSelected) {
        if (createdChars[label]) continue;
        const g = speakerGroups.find((x) => x.speaker_label === label);
        const name =
          (g?.display_name && g.display_name !== g.speaker_label
            ? g.display_name
            : g?.display_name || label) || label;
        const c = await api.createCharacterFromGroup(ep, label, {
          name: name.trim() || label,
          project_id: activeProjectId || undefined,
        });
        setCreatedChars((prev) => ({ ...prev, [label]: c }));
      }
      setBulkSelected(new Set());
    } catch (e) {
      setCharCreateError(
        e instanceof ApiError ? e.message : "Bulk create failed",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  const visibleCastGroups = speakerGroups.filter(
    (g) => !ignoredLabels.has(g.speaker_label),
  );
  const pendingCastCount = visibleCastGroups.filter(
    (g) => !createdChars[g.speaker_label],
  ).length;

  const showTranscriptSpinner =
    (!transcriptFetchDone && !transcriptError) || transcriptLoading;

  const displayProgress =
    phase === "uploading"
      ? uploadRatio
      : job?.progress != null
        ? job.progress
        : 0;

  let pipelineActive = 0;
  if (phase === "uploading") pipelineActive = 0;
  else if (phase === "processing") pipelineActive = 1;
  else if (phase === "done") {
    if (transcriptLoading || (!transcriptFetchDone && !transcriptError)) {
      pipelineActive = 2;
    } else if (speakerGroupsLoading) {
      pipelineActive = 3;
    } else if (visibleCastGroups.length === 0 && transcriptFetchDone && !transcriptError) {
      pipelineActive = 3;
    } else {
      pipelineActive = 4;
    }
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6 pb-2">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <Wand2 className="h-3 w-3" />
            Cast from footage
          </span>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-balance text-foreground md:text-6xl">
            Import from Video
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Upload a clip, get a transcript, review the detected cast, then turn each voice into a character. Add more characters manually anytime on the Characters page.
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 rounded-2xl border border-border bg-surface p-3 shadow-soft sm:grid-cols-3 lg:grid-cols-5">
        {[
          { icon: FileVideo, label: "Upload video", idx: 0 },
          { icon: Mic2, label: "Extract audio", idx: 1 },
          { icon: FileText, label: "Transcript", idx: 2 },
          { icon: Users, label: "Detected cast", idx: 3 },
          { icon: UserPlus, label: "Create characters", idx: 4 },
        ].map((step) => {
          const active = pipelineActive === step.idx;
          return (
            <div
              key={step.label}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${active ? "bg-primary/10" : "bg-transparent"}`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  active ? "bg-primary text-primary-foreground" : "bg-surface-sunken text-muted-foreground"
                }`}
              >
                <step.icon className="h-3.5 w-3.5" strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] text-muted-foreground">0{step.idx + 1}</div>
                <div className="text-xs font-semibold text-foreground">{step.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {error ? <ErrorBanner title="Request error" detail={error} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Project
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveProjectId(p.id)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                    activeProjectId === p.id
                      ? "bg-ink text-ink-foreground shadow-soft"
                      : "border border-border bg-surface text-foreground hover:border-foreground"
                  }`}
                  disabled={boot}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-teal" />
            <div className="p-8">
              <label
                htmlFor="video-upload"
                className="group flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-surface-sunken/40 p-12 text-center transition-all hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-glow transition-transform group-hover:scale-110">
                  <UploadCloud className="h-7 w-7" strokeWidth={2} />
                  <span className="absolute -inset-1 rounded-2xl ring-1 ring-primary/20" />
                </span>
                <div>
                  <div className="font-display text-xl font-semibold tracking-tight text-foreground">
                    {file ? file.name : "Drop a video, or click to browse"}
                  </div>
                  <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    MP4, MOV, MKV, WebM, M4V or AVI. Upload and processing run on your computer. Nothing leaves the machine.
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[10px] font-mono text-muted-foreground">
                  {["MP4", "MOV", "MKV", "WEBM", "M4V", "AVI"].map((f) => (
                    <span
                      key={f}
                      className="rounded-md border border-border bg-surface px-2 py-0.5 uppercase tracking-wider"
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <input
                  id="video-upload"
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v,.avi"
                  onChange={(e) => {
                    const fnext = e.target.files?.[0] ?? null;
                    setFile(fnext);
                    setPhase("idle");
                    setJob(null);
                    setPersistedMedia(null);
                    setError(null);
                    setTranscriptSegments([]);
                    setTranscriptError(null);
                    setTranscriptFetchDone(false);
                    setSpeakerGroups([]);
                    setSpeakerGroupsError(null);
                    setSelectedTranscriptSegmentId(null);
                    if (storageKey) {
                      try {
                        window.localStorage.removeItem(storageKey);
                      } catch {
                        /* ignore storage delete errors */
                      }
                    }
                  }}
                />
              </label>

              <div className="mt-6 flex flex-col items-center justify-between gap-4 sm:flex-row">
                <div className="text-xs text-muted-foreground">
                  {file ? (
                    <>
                      <span className="font-semibold text-foreground">Selected:</span> {file.name} (
                      {(file.size / (1024 * 1024)).toFixed(2)} MB)
                    </>
                  ) : (
                    "No file selected"
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy || !activeProjectId || !file}
                  onClick={() => void startUpload()}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Spinner className="h-4 w-4 border-t-primary-foreground" />
                      {phase === "uploading" ? "Uploading…" : "Processing…"}
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4" />
                      Upload &amp; process
                    </>
                  )}
                </button>
              </div>

              {(phase === "uploading" || phase === "processing") && (
                <div className="mt-6 w-full space-y-2 text-left">
                  <p className="text-xs text-muted-foreground">
                    {phase === "uploading"
                      ? "Upload progress"
                      : "Transcribing audio and grouping speakers"}
                  </p>
                  <ProgressBar value={displayProgress} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
        <Panel className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Processing status
              </div>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground">
                {job?.message
                  ? job.message
                  : mediaDone
                    ? "Import ready"
                    : "Idle. Ready when you are."}
              </h2>
            </div>
            {job ? (
              <Badge
                tone={
                  normalizeJobStatus(job.status) === "done"
                    ? "success"
                    : normalizeJobStatus(job.status) === "failed"
                      ? "danger"
                      : "accent"
                }
              >
                {job.status}
              </Badge>
            ) : mediaDone ? (
              <Badge tone="success">done</Badge>
            ) : (
              <Badge tone="default">idle</Badge>
            )}
          </div>

          {job ? (
            <div className="mt-4 space-y-3 text-sm">
              {job.message ? (
                <p className="text-muted">{job.message}</p>
              ) : (
                <p className="text-muted">Working on your video.</p>
              )}
              {phase !== "uploading" ? (
                <ProgressBar value={job.progress} />
              ) : null}
            </div>
          ) : mediaDone ? (
            <p className="mt-4 text-sm text-muted">
              Restored your latest processed upload for this project.
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted">
              Choose a video and upload to extract audio, thumbnails, and a
              transcript.
            </p>
          )}

          {mediaDone ? (
            <div className="mt-6 border-t border-white/[0.06] pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                <h3 className="text-sm font-semibold text-text">
                  Import ready
                </h3>
              </div>
              {mediaDone.duration_sec != null ? (
                <p className="mt-1 text-xs text-muted">
                  Duration: {mediaDone.duration_sec.toFixed(2)}s
                </p>
              ) : null}
              {mediaDone.transcript_language != null &&
              mediaDone.transcript_language !== "" ? (
                <p className="mt-1 text-xs text-muted">
                  Transcript language: {mediaDone.transcript_language}
                </p>
              ) : null}
              {mediaDone.transcript_segment_count != null ? (
                <p className="mt-1 text-xs text-muted">
                  Transcript segments: {mediaDone.transcript_segment_count}
                </p>
              ) : null}
              {mediaDone.import_provider === "azure_video_indexer" ? (
                <p className="mt-1 text-xs text-muted">
                  Cast signal: Azure AI Video Indexer. Speaker tags reflect detected groups and likely recurring speakers, not guaranteed real-world identity.
                </p>
              ) : mediaDone.import_provider === "local" ? (
                <p className="mt-1 text-xs text-muted">
                  Cast signal: processed locally on this machine (fallback path).
                  {mediaDone.fallback_reason != null &&
                  mediaDone.fallback_reason !== "" ? (
                    <>
                      {" "}
                      Reason: {mediaDone.fallback_reason}
                    </>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                This import is saved for the active project on your computer.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {mediaDone.thumbnail_paths.map((rel, i) => (
                  <div
                    key={rel}
                    className="overflow-hidden rounded-lg ring-1 ring-white/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(rel)}
                      alt={`Thumbnail ${i + 1}`}
                      className="h-24 w-full object-cover sm:h-28"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6 border-t border-white/[0.06] pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text">Transcript</h3>
                  {showTranscriptSpinner ? (
                    <Badge tone="accent">Loading…</Badge>
                  ) : (
                    <Badge tone="default">
                      {transcriptSegments.length} segments
                    </Badge>
                  )}
                </div>
                {transcriptError ? (
                  <div className="mt-3">
                    <ErrorBanner
                      title="Transcript error"
                      detail={transcriptError}
                    />
                  </div>
                ) : null}
                {showTranscriptSpinner && !transcriptError ? (
                  <div className="mt-4 flex items-center gap-2 text-sm text-muted">
                    <Spinner className="h-4 w-4 border-t-canvas" />
                    Loading transcript…
                  </div>
                ) : null}
                {transcriptFetchDone &&
                !transcriptError &&
                transcriptSegments.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    No transcript segments (silent clip or model returned empty).
                  </p>
                ) : null}
                {transcriptFetchDone && transcriptSegments.length > 0 ? (
                  <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-white/[0.02] p-2 ring-1 ring-white/[0.06]">
                    {transcriptSegments.map((row) => {
                      const group = speakerGroups.find(
                        (g) => g.speaker_label === row.speaker_label,
                      );
                      const label =
                        group?.display_name ?? row.speaker_label ?? "Unknown";
                      const ep = transcriptEpisodeId;
                      const canSpeaker = Boolean(row.speaker_label);
                      const sel = selectedTranscriptSegmentId === row.segment_id;
                      return (
                        <li
                          key={row.segment_id}
                          className={`rounded-lg text-sm ring-1 transition hover:bg-white/[0.02] ${
                            sel
                              ? "bg-accent/10 ring-accent/35"
                              : "ring-transparent"
                          }`}
                        >
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left"
                            onClick={() =>
                              setSelectedTranscriptSegmentId(row.segment_id)
                            }
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="font-mono text-[11px] text-muted">
                                {formatTimecode(row.start_time)} to{" "}
                                {formatTimecode(row.end_time)}
                              </span>
                              <Badge
                                tone={
                                  group?.is_narrator
                                    ? "violet"
                                    : row.speaker_label?.startsWith("SPEAKER_")
                                      ? "accent"
                                      : "default"
                                }
                              >
                                {label}
                              </Badge>
                            </div>
                            <p className="mt-1 text-text">{row.text}</p>
                          </button>
                          <div
                            className="flex flex-wrap gap-2 border-t border-white/[0.06] px-3 py-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ep ? (
                              <Link
                                href={`/replace-lines?episode=${encodeURIComponent(ep)}&segment=${encodeURIComponent(row.segment_id)}`}
                                className="inline-flex items-center rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-text ring-1 ring-white/[0.08] transition hover:bg-white/[0.1]"
                              >
                                Use in Replace Lines
                              </Link>
                            ) : null}
                            <Button
                              type="button"
                              variant="secondary"
                              className="!px-2.5 !py-1 !text-xs"
                              disabled={!canSpeaker}
                              onClick={() => {
                                const lab = row.speaker_label;
                                if (!lab) return;
                                setSelectedTranscriptSegmentId(row.segment_id);
                                setCreatingLabel(lab);
                                const g = speakerGroups.find(
                                  (x) => x.speaker_label === lab,
                                );
                                setCharNameInput(
                                  g && g.display_name !== lab
                                    ? g.display_name
                                    : "",
                                );
                                window.requestAnimationFrame(() => {
                                  document
                                    .getElementById(speakerRowDomId(lab))
                                    ?.scrollIntoView({
                                      behavior: "smooth",
                                      block: "center",
                                    });
                                });
                              }}
                            >
                              <UserPlus className="h-3 w-3" />
                              Create character from speaker
                            </Button>
                            {group?.is_narrator ? null : (
                              <Button
                                type="button"
                                variant="secondary"
                                className="!px-2.5 !py-1 !text-xs"
                                disabled={!canSpeaker}
                                onClick={() => {
                                  const lab = row.speaker_label;
                                  if (!lab) return;
                                  void handleNarrator(lab, true);
                                }}
                              >
                                Mark as narrator
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {mediaDone && transcriptFetchDone ? (
              <div className="mt-6 border-t border-white/[0.06] pt-6">
              <p className="mb-4 max-w-prose text-sm text-muted">
                This is your detected cast: each entry is a voice cluster from the
                transcript. Rename, merge duplicates, ignore extras, or create
                characters in one pass.
              </p>
              {visibleCastGroups.length > 0 ? (
                <div className="mb-4 rounded-xl bg-primary/10 px-4 py-3 ring-1 ring-primary/20">
                  <p className="text-sm font-semibold text-foreground">
                    You found {visibleCastGroups.length} likely cast{" "}
                    {visibleCastGroups.length === 1 ? "voice" : "voices"}.
                  </p>
                  {pendingCastCount > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pendingCastCount} still need a character card. Use checkboxes
                      to create several at once.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400/90">
                      Every visible voice has a character. Next: Voice Studio,
                      then Replace Lines.
                    </p>
                  )}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-semibold text-text">
                    Detected cast
                  </h3>
                </div>
                {speakerGroupsLoading ? (
                  <Badge tone="accent">Loading…</Badge>
                ) : (
                  <Badge tone="default">
                    {visibleCastGroups.length} shown
                    {ignoredLabels.size > 0
                      ? ` · ${ignoredLabels.size} hidden`
                      : ""}
                  </Badge>
                )}
              </div>
              {speakerGroupsError ? (
                <div className="mt-3">
                  <ErrorBanner
                    title="Cast detection"
                    detail={speakerGroupsError}
                  />
                </div>
              ) : null}
              {charCreateError ? (
                <div className="mt-3">
                  <ErrorBanner
                    title="Character creation"
                    detail={charCreateError}
                  />
                </div>
              ) : null}
              {speakerGroupsLoading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted">
                  <Spinner className="h-4 w-4 border-t-canvas" />
                  Resolving detected cast…
                </div>
              ) : null}
              {!speakerGroupsLoading && speakerGroups.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  No separate voices were detected. Try a clip with clearer
                  turns, or add characters manually.
                </p>
              ) : null}
              {!speakerGroupsLoading &&
              speakerGroups.length > 0 &&
              pendingCastCount > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={
                      bulkBusy || bulkSelected.size === 0 || !transcriptEpisodeId
                    }
                    onClick={() => void bulkCreateCharacters()}
                  >
                    {bulkBusy ? (
                      <Spinner className="h-4 w-4 border-t-primary-foreground" />
                    ) : null}
                    Create selected ({bulkSelected.size})
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() => {
                      const pending = visibleCastGroups
                        .filter((x) => !createdChars[x.speaker_label])
                        .map((x) => x.speaker_label);
                      setBulkSelected(new Set(pending));
                    }}
                  >
                    Select all pending
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setBulkSelected(new Set())}
                  >
                    Clear selection
                  </Button>
                </div>
              ) : null}
              {!speakerGroupsLoading && speakerGroups.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {visibleCastGroups.map((g) => (
                    <li
                      key={g.speaker_label}
                      id={speakerRowDomId(g.speaker_label)}
                      className="scroll-mt-24 rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border text-primary"
                            checked={bulkSelected.has(g.speaker_label)}
                            disabled={Boolean(createdChars[g.speaker_label])}
                            onChange={() => toggleBulkLabel(g.speaker_label)}
                            title="Include in bulk create"
                          />
                          <Mic2 className="h-4 w-4 text-muted" />
                          {editingLabel === g.speaker_label ? (
                            <form
                              className="flex items-center gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void handleRename(g.speaker_label, editValue);
                              }}
                            >
                              <input
                                className="rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                autoFocus
                              />
                              <Button type="submit" variant="secondary">
                                Save
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setEditingLabel(null)}
                              >
                                Cancel
                              </Button>
                            </form>
                          ) : (
                            <>
                              <span className="text-sm font-medium text-text">
                                {g.display_name}
                              </span>
                              {g.display_name !== g.speaker_label ? (
                                <span className="text-[11px] text-muted">
                                  ({g.speaker_label})
                                </span>
                              ) : null}
                              {g.is_narrator ? (
                                <Badge tone="violet">narrator</Badge>
                              ) : null}
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setEditingLabel(g.speaker_label);
                              setEditValue(g.display_name);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                            Rename
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void handleNarrator(
                                g.speaker_label,
                                !g.is_narrator,
                              )
                            }
                          >
                            {g.is_narrator
                              ? "Unmark narrator"
                              : "Mark narrator / off-screen"}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => toggleIgnore(g.speaker_label)}
                          >
                            <EyeOff className="h-3 w-3" />
                            Ignore for now
                          </Button>
                        </div>
                      </div>
                      {(() => {
                        const others = visibleCastGroups
                          .filter((x) => x.speaker_label !== g.speaker_label)
                          .map((x) => x.speaker_label);
                        const pick =
                          mergeTargetFor[g.speaker_label] ?? others[0] ?? "";
                        return others.length > 0 ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
                            <span className="text-[11px] font-medium text-muted">
                              Merge duplicate
                            </span>
                            <select
                              className="rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1.5 text-xs text-text outline-none focus:border-accent/40"
                              value={pick}
                              onChange={(e) =>
                                setMergeTargetFor((m) => ({
                                  ...m,
                                  [g.speaker_label]: e.target.value,
                                }))
                              }
                            >
                              {others.map((lab) => (
                                <option key={lab} value={lab}>
                                  into {lab}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="secondary"
                              className="!px-2.5 !py-1 !text-xs"
                              disabled={mergeBusy || !pick}
                              onClick={() => void runMerge(g.speaker_label, pick)}
                            >
                              <GitMerge className="h-3 w-3" />
                              Merge
                            </Button>
                          </div>
                        ) : null;
                      })()}
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                        <span>{g.segment_count} segments</span>
                        <span>{g.total_speaking_duration.toFixed(1)}s total</span>
                      </div>
                      {g.sample_texts.length > 0 ? (
                        <div className="mt-3 space-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            Sample lines
                          </p>
                          {g.sample_texts.map((t, i) => (
                            <p
                              key={i}
                              className="truncate text-xs italic text-muted"
                            >
                              &ldquo;{t}&rdquo;
                            </p>
                          ))}
                        </div>
                      ) : null}

                      {createdChars[g.speaker_label] ? (
                        <div className="mt-3 flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2">
                          <CheckCircle2 className="h-4 w-4 text-accent" />
                          <span className="text-xs font-medium text-text">
                            Saved as &ldquo;{createdChars[g.speaker_label].name}&rdquo;
                          </span>
                        </div>
                      ) : creatingLabel === g.speaker_label ? (
                        <form
                          className="mt-3 flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleCreateCharacter(
                              g.speaker_label,
                              charNameInput,
                            );
                          }}
                        >
                          <input
                            className="flex-1 rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1.5 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                            placeholder="Character name…"
                            value={charNameInput}
                            onChange={(e) => setCharNameInput(e.target.value)}
                            autoFocus
                          />
                          <Button
                            type="submit"
                            disabled={!charNameInput.trim()}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setCreatingLabel(null)}
                          >
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <Button
                          variant="secondary"
                          className="mt-3"
                          onClick={() => {
                            setCreatingLabel(g.speaker_label);
                            setCharNameInput(
                              g.display_name !== g.speaker_label
                                ? g.display_name
                                : "",
                            );
                          }}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          Create character
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {ignoredLabels.size > 0 ? (
                <div className="mt-4 rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Hidden for now ({ignoredLabels.size})
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    These voices stay out of your main list. Restore anytime.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[...ignoredLabels].map((lab) => (
                      <button
                        key={lab}
                        type="button"
                        className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-text ring-1 ring-white/[0.08] transition hover:bg-white/[0.1]"
                        onClick={() => toggleIgnore(lab)}
                      >
                        Restore {lab}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {transcriptEpisodeId && transcriptSegments.length > 0 ? (
                <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
                  <p className="text-sm font-medium text-foreground">
                    Transcript ready. Swap performances when your cast has voices.
                  </p>
                  <Link
                    href={`/replace-lines?episode=${encodeURIComponent(transcriptEpisodeId)}`}
                    className="mt-2 inline-flex text-sm font-semibold text-accent underline-offset-4 hover:underline"
                  >
                    Open Replace Lines
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

        </Panel>

          <div className="rounded-2xl border border-border bg-gradient-warm p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Wand2 className="h-3.5 w-3.5" />
              </span>
              <div>
                <div className="font-display text-sm font-semibold text-foreground">
                  Cleaner audio, better speakers
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Use a clip with one speaker per line and minimal background music for best diarization. Ten minutes is plenty.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-16 border-t border-border pt-6 text-center text-[11px] text-muted-foreground">
        CastVoice · A studio for crafting voices.
      </footer>
    </div>
  );
}
