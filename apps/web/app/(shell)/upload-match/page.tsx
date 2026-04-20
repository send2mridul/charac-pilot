"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Film, UploadCloud } from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  EpisodeMediaJobResult,
  JobDto,
  MatchCandidateDto,
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

function candidatesFromJob(job: JobDto | null): MatchCandidateDto[] {
  if (!job?.result || typeof job.result !== "object") return [];
  const raw = (job.result as Record<string, unknown>).match_candidates;
  if (!Array.isArray(raw)) return [];
  return raw as MatchCandidateDto[];
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
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const sec = r < 10 ? `0${r.toFixed(2)}` : r.toFixed(2);
  return `${m}:${sec}`;
}

type Phase = "idle" | "uploading" | "processing" | "done" | "failed";

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
  const [transcriptSegments, setTranscriptSegments] = useState<
    TranscriptSegmentDto[]
  >([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptFetchDone, setTranscriptFetchDone] = useState(false);

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
    setTranscriptSegments([]);
    setTranscriptError(null);
    setTranscriptFetchDone(false);
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

  const mediaDone = job?.status === "done" ? mediaResultFromJob(job) : null;
  const candidates = job?.status === "done" ? candidatesFromJob(job) : [];
  const transcriptEpisodeId = resolveEpisodeIdForTranscript(job, mediaDone);

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
        title="New Upload / Match"
        subtitle="Upload a video: local save, FFmpeg thumbnails + WAV, then faster-whisper transcription. Poll the job, then transcript segments load from the API."
        actions={<Button variant="secondary">Use library</Button>}
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
          <p className="mt-4 text-sm font-medium text-text">
            Video upload (multipart)
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            <code className="rounded bg-white/5 px-1 py-0.5 text-xs">
              POST /projects/&#123;id&#125;/episodes/upload
            </code>{" "}
            with form field <code className="text-xs">file</code>. MP4, MOV,
            MKV, WebM, M4V, AVI supported.
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
              setError(null);
              setTranscriptSegments([]);
              setTranscriptError(null);
              setTranscriptFetchDone(false);
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
                  : "Server processing (FFmpeg + Whisper)"}
              </p>
              <ProgressBar value={displayProgress} />
            </div>
          )}
        </Panel>

        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">Job status</h2>
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
            ) : (
              <Badge tone="default">idle</Badge>
            )}
          </div>

          {job ? (
            <div className="mt-4 space-y-3 text-sm">
              <p className="font-mono text-xs text-muted">{job.id}</p>
              <p className="text-xs text-muted">type: {job.type}</p>
              <p className="text-muted">{job.message}</p>
              {phase !== "uploading" ? (
                <ProgressBar value={job.progress} />
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              Upload a file to create an <code className="text-xs">episode_media</code>{" "}
              job, then this panel polls{" "}
              <code className="rounded bg-white/5 px-1 py-0.5 text-xs">
                GET /jobs/&#123;id&#125;
              </code>
              .
            </p>
          )}

          {mediaDone ? (
            <div className="mt-6 border-t border-white/[0.06] pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                <h3 className="text-sm font-semibold text-text">
                  Processed episode
                </h3>
              </div>
              <p className="mt-2 font-mono text-xs text-muted">
                {mediaDone.episode_id}
              </p>
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
                  Transcript segments (job): {mediaDone.transcript_segment_count}
                </p>
              ) : null}
              <p className="mt-2 break-all text-xs text-muted">
                Video: {mediaDone.source_video_path}
              </p>
              <p className="mt-1 break-all text-xs text-muted">
                Audio: {mediaDone.extracted_audio_path}
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
                    {"Fetching GET /episodes/{id}/segments…"}
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
                    {transcriptSegments.map((row) => (
                      <li
                        key={row.segment_id}
                        className="rounded-lg px-3 py-2 text-sm hover:bg-white/[0.03]"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-mono text-[11px] text-muted">
                            {formatTimecode(row.start_time)} →{" "}
                            {formatTimecode(row.end_time)}
                          </span>
                          <span className="text-[11px] text-muted">
                            {row.speaker_label ?? "—"}
                          </span>
                        </div>
                        <p className="mt-1 text-text">{row.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-6 border-t border-white/[0.06] pt-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text">
                Match candidates
              </h3>
              <Badge tone="violet">Heuristic (stub)</Badge>
            </div>
            {candidates.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                {job?.type === "episode_media"
                  ? "Match heuristics are not part of this milestone."
                  : job?.status === "done"
                    ? "No candidates on this job."
                    : "Complete a non-media stub job to load sample matches."}
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {candidates.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text">{c.label}</p>
                        <p className="mt-1 text-xs text-muted">{c.source}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-accent" />
                        <span className="text-sm font-semibold text-text">
                          {Math.round(c.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                    <ProgressBar value={c.confidence} className="mt-3" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
