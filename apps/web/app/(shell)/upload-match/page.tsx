"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Film,
  Mic2,
  Pencil,
  UploadCloud,
  UserPlus,
  Users,
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
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";

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
  };
}

/** Episode id for transcript API: prefer full media result, else raw job.result (trimmed). */
function resolveEpisodeIdForTranscript(
  job: JobDto | null,
  media: EpisodeMediaJobResult | null,
): string | null {
  const fromMedia = media?.episode_id?.trim();
  if (fromMedia) return fromMedia;
  if (job?.status !== "done" || !job.result || typeof job.result !== "object") {
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

  const storageKey = activeProjectId
    ? `castvoice:import-context:${activeProjectId}`
    : null;

  const pollJob = useCallback(async (jobId: string) => {
    const j = await api.getJob(jobId);
    setJob(j);
    if (j.status === "queued" || j.status === "running") {
      window.setTimeout(() => void pollJob(jobId), 400);
      return;
    }
    if (j.status === "failed") {
      setPhase("failed");
      return;
    }
    if (j.status === "done") {
      setPhase("done");
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

  const mediaDone = persistedMedia ?? (job?.status === "done" ? mediaResultFromJob(job) : null);
  const transcriptEpisodeId = resolveEpisodeIdForTranscript(job, mediaDone);

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

  const showTranscriptSpinner =
    (!transcriptFetchDone && !transcriptError) || transcriptLoading;

  const displayProgress =
    phase === "uploading"
      ? uploadRatio
      : job?.progress != null
        ? job.progress
        : 0;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Import from Video"
        subtitle="Bring in an older episode to detect speakers, build a transcript, and turn speaker groups into characters. You can also add characters manually at any time."
      />

      <Panel>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Project
        </label>
        <select
          className="mt-2 w-full max-w-md rounded-xl border border-white/[0.08] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/20 sm:w-auto"
          value={activeProjectId ?? ""}
          disabled={boot || projects.length === 0}
          onChange={(e) => setActiveProjectId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Panel>

      {error ? <ErrorBanner title="Request error" detail={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="flex min-h-[300px] flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-dim text-accent ring-1 ring-accent/25">
            <UploadCloud className="h-8 w-8" />
          </div>
          <p className="mt-4 text-sm font-medium text-text">Upload video</p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            MP4, MOV, MKV, WebM, M4V, or AVI. Upload and processing run on your
            computer.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v,.avi"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
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

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
            >
              <Film className="h-4 w-4" />
              {file ? "Change file" : "Choose video"}
            </Button>
          </div>

          {file ? (
            <p className="mt-3 max-w-md truncate text-xs text-muted">
              {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted">No file selected</p>
          )}

          <Button
            className="mt-6"
            disabled={busy || !activeProjectId || !file}
            onClick={() => void startUpload()}
          >
            {busy ? (
              <>
                <Spinner className="h-4 w-4 border-t-canvas" />
                {phase === "uploading" ? "Uploading…" : "Processing…"}
              </>
            ) : (
              "Upload & process"
            )}
          </Button>

          {(phase === "uploading" || phase === "processing") && (
            <div className="mt-6 w-full max-w-sm space-y-2 text-left">
              <p className="text-xs text-muted">
                {phase === "uploading"
                  ? "Upload progress"
                  : "Transcribing audio and grouping speakers"}
              </p>
              <ProgressBar value={displayProgress} />
            </div>
          )}
        </Panel>

        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">Processing status</h2>
            {job ? (
              <Badge
                tone={
                  job.status === "done"
                    ? "success"
                    : job.status === "failed"
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
                Speaker groups are an onboarding shortcut. Use them to name
                voices and create characters, or skip straight to Characters and
                Voice Studio.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-semibold text-text">
                    Speaker groups
                  </h3>
                </div>
                {speakerGroupsLoading ? (
                  <Badge tone="accent">Loading…</Badge>
                ) : (
                  <Badge tone="default">{speakerGroups.length} speakers</Badge>
                )}
              </div>
              {speakerGroupsError ? (
                <div className="mt-3">
                  <ErrorBanner
                    title="Speaker groups error"
                    detail={speakerGroupsError}
                  />
                </div>
              ) : null}
              {charCreateError ? (
                <div className="mt-3">
                  <ErrorBanner
                    title="Character creation error"
                    detail={charCreateError}
                  />
                </div>
              ) : null}
              {speakerGroupsLoading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted">
                  <Spinner className="h-4 w-4 border-t-canvas" />
                  Loading speaker groups…
                </div>
              ) : null}
              {!speakerGroupsLoading && speakerGroups.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  No speaker groups detected.
                </p>
              ) : null}
              {!speakerGroupsLoading && speakerGroups.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {speakerGroups.map((g) => (
                    <li
                      key={g.speaker_label}
                      id={speakerRowDomId(g.speaker_label)}
                      className="scroll-mt-24 rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
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
                              : "Mark as narrator"}
                          </Button>
                        </div>
                      </div>
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
            </div>
          ) : null}

        </Panel>
      </div>
    </div>
  );
}
