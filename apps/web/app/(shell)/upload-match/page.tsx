"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  FileVideo,
  GitMerge,
  Mic2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  UploadCloud,
  UserPlus,
  Users,
  Volume2,
  Wand2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  EpisodeDto,
  EpisodeMediaJobResult,
  JobDto,
  ReplacementDto,
  SpeakerGroupDto,
  TranscriptSegmentDto,
} from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel } from "@/components/ui/Panel";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { SourceVoiceModal } from "@/components/ui/SourceVoiceModal";
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
    transcript_coverage_low:
      typeof r.transcript_coverage_low === "boolean"
        ? r.transcript_coverage_low
        : undefined,
    transcript_coverage_ratio:
      typeof r.transcript_coverage_ratio === "number"
        ? r.transcript_coverage_ratio
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
  if (
    !job ||
    normalizeJobStatus(job.status) !== "done" ||
    !job.result ||
    typeof job.result !== "object"
  ) {
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

/** English UI label for detected spoken language (never non-Latin script). */
function spokenLanguageUiLabel(code: string | null | undefined): string {
  if (code == null || String(code).trim() === "") return "";
  const b = String(code).trim().toLowerCase().split("-")[0] ?? "";
  if (b === "hi") return "Hindi";
  if (b === "en") return "English";
  return String(code).trim();
}

function speakerRowDomId(label: string): string {
  return `spk-${label.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

function matchCharacterIdForSegment(
  seg: TranscriptSegmentDto,
  chars: CharacterDto[],
): string {
  const label = seg.speaker_label ?? "";
  const hit = chars.find(
    (c) =>
      Boolean(c.default_voice_id) &&
      Boolean(label) &&
      c.source_speaker_labels.includes(label),
  );
  return hit?.id ?? "";
}

type Phase = "idle" | "uploading" | "processing" | "done" | "failed";

const PIPELINE_STEPS = [
  "Uploading video",
  "Extracting audio",
  "Analyzing speech",
  "Detecting cast",
  "Building transcript",
  "Preparing characters",
] as const;

const PIPELINE_ICONS = [
  FileVideo,
  Volume2,
  Mic2,
  Users,
  FileText,
  UserPlus,
] as const;

function inferPipelineStep(phase: Phase, job: JobDto | null): number {
  if (phase === "uploading") return 0;
  if (phase !== "processing") return PIPELINE_STEPS.length - 1;
  const m = (job?.message || "").toLowerCase();
  const p = typeof job?.progress === "number" ? job.progress : 0;
  if (m.includes("detecting speaker")) return 3;
  if (m.includes("building transcript") || m.includes("cast candidate")) return 4;
  if (
    m.includes("reading") ||
    m.includes("extract") ||
    m.includes("preview frame") ||
    p < 0.46
  ) {
    return 1;
  }
  if (
    m.includes("transcrib") ||
    m.includes("analysis") ||
    m.includes("connecting") ||
    m.includes("on-device") ||
    m.includes("cloud") ||
    p < 0.78
  ) {
    return 2;
  }
  if (p < 0.88) return 3;
  if (p < 0.99) return 4;
  return 5;
}
type PersistedImportContext = {
  media: EpisodeMediaJobResult;
};

export default function UploadMatchPage() {
  const toast = useToast();
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
  const [mergeTargetFor, setMergeTargetFor] = useState<Record<string, string>>(
    {},
  );
  /** Project roster: used to know if any character has a voice (Replace Lines gating). */
  const [projectRoster, setProjectRoster] = useState<CharacterDto[]>([]);
  const [episodeReplacements, setEpisodeReplacements] = useState<
    ReplacementDto[]
  >([]);
  const [charPickBySegment, setCharPickBySegment] = useState<
    Record<string, string>
  >({});
  const [editSegmentId, setEditSegmentId] = useState<string | null>(null);
  const [editSegmentDraft, setEditSegmentDraft] = useState("");
  const editRowRef = useRef<HTMLLIElement>(null);
  const [generatingSegmentId, setGeneratingSegmentId] = useState<string | null>(
    null,
  );
  const [batchLineBusy, setBatchLineBusy] = useState(false);
  const [sourceVoiceModalChar, setSourceVoiceModalChar] =
    useState<CharacterDto | null>(null);
  const [sourceVoiceBusy, setSourceVoiceBusy] = useState(false);
  const [confirmDeleteSegId, setConfirmDeleteSegId] = useState<string | null>(null);
  const [playingSourceSegId, setPlayingSourceSegId] = useState<string | null>(null);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [projectClipCount, setProjectClipCount] = useState(0);
  const [projectEpisodes, setProjectEpisodes] = useState<EpisodeDto[]>([]);
  const uploadSessionRef = useRef(0);
  const progressTrustRef = useRef({
    lastP: -1,
    lastMoveAt: 0,
    lastMsg: "",
    lastUpd: "",
  });
  const [actionBusy, setActionBusy] = useState(false);
  const [importBootKind, setImportBootKind] = useState<
    "none" | "restored" | "fresh"
  >("none");
  const [coverageBannerDismissedFor, setCoverageBannerDismissedFor] = useState<string | null>(null);
  const [avatarBusyIndex, setAvatarBusyIndex] = useState<number | null>(null);
  const [processingTrust, setProcessingTrust] = useState({
    determinate: true,
    longWait: false,
    severeStall: false,
  });

  const storageKey = activeProjectId
    ? `castweave:import-context:${activeProjectId}`
    : null;
  const legacyStorageKey = activeProjectId
    ? `castvoice:import-context:${activeProjectId}`
    : null;

  const pollJob = useCallback(
    async (jobId: string, startedAt = Date.now(), sessionId?: number) => {
      const sid = sessionId ?? uploadSessionRef.current;
      try {
        const j = await api.getJob(jobId);
        if (sid !== uploadSessionRef.current) return;
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
            () => void pollJob(jobId, startedAt, sid),
            JOB_POLL_INTERVAL_MS,
          );
          return;
        }
        if (st === "failed") {
          setPhase("failed");
          return;
        }
        if (st === "done") {
          const newMedia = mediaResultFromJob(j);
          if (newMedia) setPersistedMedia(newMedia);
          setPhase("done");
          setImportBootKind("none");
          setFile(null);
          setTranscriptSegments([]);
          setTranscriptFetchDone(false);
          setTranscriptError(null);
          setSpeakerGroups([]);
          setSpeakerGroupsError(null);
          setCreatedChars({});
          setEditSegmentId(null);
          toast("New import ready. Workspace updated.");
          if (activeProjectId) {
            void api.listEpisodes(activeProjectId).then((rows) => {
              setProjectEpisodes(
                rows
                  .filter((e) => e.segment_count > 0)
                  .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
              );
            }).catch(() => {});
          }
          return;
        }
        setPhase("failed");
        setError(
          `Unexpected job status from server: ${String(j.status ?? "").slice(0, 120)}`,
        );
      } catch (e) {
        if (sid !== uploadSessionRef.current) return;
        setPhase("failed");
        setError(
          e instanceof ApiError ? e.message : "Could not load job status",
        );
      }
    },
    [toast, activeProjectId],
  );

  async function startUpload() {
    if (!activeProjectId || !file || busy) return;
    uploadSessionRef.current += 1;
    const sessionId = uploadSessionRef.current;
    if (storageKey) {
      try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
    setImportBootKind("fresh");
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
      await pollJob(res.job_id, Date.now(), sessionId);
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
    ? `castweave:ignored-cast:${transcriptEpisodeId}`
    : null;
  const legacyIgnoredStorageKey = transcriptEpisodeId
    ? `castvoice:ignored-cast:${transcriptEpisodeId}`
    : null;

  useEffect(() => {
    setIgnoredLabels(new Set());
  }, [transcriptEpisodeId]);

  useEffect(() => {
    if (!ignoredStorageKey) return;
    try {
      const raw =
        window.localStorage.getItem(ignoredStorageKey) ??
        (legacyIgnoredStorageKey
          ? window.localStorage.getItem(legacyIgnoredStorageKey)
          : null);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return;
      setIgnoredLabels(new Set(arr.filter((x) => typeof x === "string")));
      if (legacyIgnoredStorageKey) {
        try {
          window.localStorage.removeItem(legacyIgnoredStorageKey);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }, [ignoredStorageKey, legacyIgnoredStorageKey]);

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
    setPhase("idle");
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !activeProjectId) return;
    if (importBootKind === "fresh") return;
    let cancelled = false;
    try {
      const raw =
        window.localStorage.getItem(storageKey) ??
        (legacyStorageKey ? window.localStorage.getItem(legacyStorageKey) : null);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedImportContext;
        if (parsed?.media?.episode_id) {
          setPersistedMedia(parsed.media);
          setImportBootKind("restored");
          setPhase("done");
          if (legacyStorageKey) {
            try {
              window.localStorage.removeItem(legacyStorageKey);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
    } catch {
      /* ignore invalid local data */
    }

    if (phase !== "idle" && phase !== "failed") return;
    if (busy) return;

    void (async () => {
      try {
        const eps = await api.listEpisodes(activeProjectId);
        const scored = eps
          .filter((e) => e.segment_count > 0)
          .sort(
            (a, b) =>
              new Date(b.updated_at).getTime() -
              new Date(a.updated_at).getTime(),
          );
        const ep = scored.find((e) => e.status === "ready") ?? scored[0];
        if (!ep || cancelled) return;
        const media: EpisodeMediaJobResult = {
          episode_id: ep.id,
          project_id: ep.project_id,
          source_video_path: ep.source_video_path ?? "",
          extracted_audio_path: ep.extracted_audio_path ?? "",
          thumbnail_paths: ep.thumbnail_paths ?? [],
          duration_sec: ep.duration_sec ?? undefined,
          transcript_segment_count: ep.segment_count,
        };
        setPersistedMedia(media);
        setPhase("done");
        setImportBootKind("restored");
        toast("Loaded saved import for this project");
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey, legacyStorageKey, activeProjectId, phase, busy, toast, importBootKind]);

  useEffect(() => {
    if (phase !== "processing") return;
    progressTrustRef.current = {
      lastP: -1,
      lastMoveAt: Date.now(),
      lastMsg: "",
      lastUpd: "",
    };
    setProcessingTrust({
      determinate: true,
      longWait: false,
      severeStall: false,
    });
  }, [phase]);

  useEffect(() => {
    if (phase !== "processing" || !job) return;
    const st = normalizeJobStatus(job.status);
    if (st !== "running" && st !== "queued") return;

    const now = Date.now();
    const r = progressTrustRef.current;
    const p = Number(job.progress) || 0;
    const msg = job.message || "";
    const upd = job.updated_at || "";

    if (r.lastUpd === "" && r.lastMoveAt === 0) {
      r.lastMoveAt = now;
    }
    if (upd !== r.lastUpd || msg !== r.lastMsg) {
      r.lastMoveAt = now;
      r.lastMsg = msg;
      r.lastUpd = upd;
    }
    if (r.lastP < 0) r.lastP = p;
    if (Math.abs(p - r.lastP) > 0.004) {
      r.lastP = p;
      r.lastMoveAt = now;
    }

    const idleMs = now - r.lastMoveAt;
    const updatedAtMs = Date.parse(job.updated_at);
    const sinceServerUpdate =
      Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? now - updatedAtMs : 0;

    const determinate = idleMs < 90_000;
    const longWait = idleMs > 45_000;
    const severeStall = sinceServerUpdate > 240_000;

    setProcessingTrust((prev) => {
      if (
        prev.determinate === determinate &&
        prev.longWait === longWait &&
        prev.severeStall === severeStall
      ) {
        return prev;
      }
      return { determinate, longWait, severeStall };
    });
  }, [job, phase]);

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

  useEffect(() => {
    if (!activeProjectId) { setProjectEpisodes([]); return; }
    let c = false;
    void api.listEpisodes(activeProjectId).then((rows) => {
      if (!c) setProjectEpisodes(rows.filter((e) => e.segment_count > 0).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
    }).catch(() => { if (!c) setProjectEpisodes([]); });
    return () => { c = true; };
  }, [activeProjectId, phase]);

  useEffect(() => {
    if (!activeProjectId || phase !== "done") {
      setProjectRoster([]);
      return;
    }
    let cancelled = false;
    void api.listCharacters(activeProjectId).then((rows) => {
      if (!cancelled) setProjectRoster(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, phase, createdChars]);

  useEffect(() => {
    const ep = transcriptEpisodeId;
    if (!ep || phase !== "done") {
      setEpisodeReplacements([]);
      return;
    }
    let cancelled = false;
    void api.listEpisodeReplacements(ep).then((rows) => {
      if (!cancelled) setEpisodeReplacements(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [transcriptEpisodeId, phase]);

  useEffect(() => {
    if (!transcriptSegments.length || !projectRoster.length) return;
    setCharPickBySegment((prev) => {
      const next = { ...prev };
      for (const row of transcriptSegments) {
        if (next[row.segment_id]) continue;
        const m = matchCharacterIdForSegment(row, projectRoster);
        if (m) next[row.segment_id] = m;
      }
      return next;
    });
  }, [transcriptSegments, projectRoster]);

  const anyCharacterHasVoice = projectRoster.some((c) =>
    Boolean(c.default_voice_id),
  );

  useEffect(() => {
    if (!activeProjectId || phase !== "done") { setProjectClipCount(0); return; }
    let c = false;
    void api.listProjectClips(activeProjectId).then((rows) => {
      if (!c) setProjectClipCount(rows.length);
    }).catch(() => { if (!c) setProjectClipCount(0); });
    return () => { c = true; };
  }, [activeProjectId, phase, episodeReplacements]);

  useEffect(() => {
    if (editSegmentId && editRowRef.current) {
      editRowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [editSegmentId]);

  function switchToEpisode(ep: EpisodeDto) {
    if (sourceAudioRef.current) { sourceAudioRef.current.pause(); sourceAudioRef.current = null; }
    setPlayingSourceSegId(null);
    const media: EpisodeMediaJobResult = {
      episode_id: ep.id,
      project_id: ep.project_id,
      source_video_path: ep.source_video_path ?? "",
      extracted_audio_path: ep.extracted_audio_path ?? "",
      thumbnail_paths: ep.thumbnail_paths ?? [],
      duration_sec: ep.duration_sec ?? undefined,
      transcript_segment_count: ep.segment_count,
    };
    setPersistedMedia(media);
    setPhase("done");
    setJob(null);
    setTranscriptSegments([]);
    setTranscriptFetchDone(false);
    setTranscriptError(null);
    setSpeakerGroups([]);
    setSpeakerGroupsError(null);
    setCreatedChars({});
    setSelectedTranscriptSegmentId(null);
    setEditSegmentId(null);
    toast("Switched to imported video");
  }

  function handleDeleteSegment(segId: string) {
    if (!transcriptEpisodeId) return;
    setConfirmDeleteSegId(segId);
  }

  async function executeDeleteSegment() {
    const ep = transcriptEpisodeId;
    const segId = confirmDeleteSegId;
    if (!ep || !segId) return;
    setConfirmDeleteSegId(null);
    try {
      await api.deleteTranscriptSegment(ep, segId);
      setTranscriptSegments((prev) => prev.filter((s) => s.segment_id !== segId));
      toast("Transcript line removed");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete segment");
    }
  }

  function playSourceSegment(episodeId: string, segmentId: string) {
    if (playingSourceSegId === segmentId) {
      sourceAudioRef.current?.pause();
      setPlayingSourceSegId(null);
      return;
    }
    if (sourceAudioRef.current) { sourceAudioRef.current.pause(); sourceAudioRef.current = null; }
    const url = api.segmentSourceAudioUrl(episodeId, segmentId);
    const audio = new Audio(url);
    sourceAudioRef.current = audio;
    setPlayingSourceSegId(segmentId);
    audio.onended = () => { setPlayingSourceSegId(null); sourceAudioRef.current = null; };
    audio.onerror = () => { setPlayingSourceSegId(null); sourceAudioRef.current = null; toast("Could not play source audio for this line"); };
    audio.play().catch(() => { setPlayingSourceSegId(null); sourceAudioRef.current = null; });
  }

  async function generateLineFromTranscript(
    segmentId: string,
    text: string,
    options?: { quiet?: boolean },
  ): Promise<boolean> {
    if (generatingSegmentId === segmentId || batchLineBusy) return false;
    const ep = transcriptEpisodeId;
    const cid = charPickBySegment[segmentId];
    if (!ep || !cid || !text.trim()) {
      if (!options?.quiet) {
        setError("Pick a character with a voice and a line to speak.");
      }
      return false;
    }
    const ch = projectRoster.find((c) => c.id === cid);
    if (!ch?.default_voice_id) {
      if (!options?.quiet) {
        setError(
          "That character needs a voice. Attach one in Voice Studio first.",
        );
      }
      return false;
    }
    setGeneratingSegmentId(segmentId);
    if (!options?.quiet) setError(null);
    try {
      const line = text.trim();
      const existing = episodeReplacements.find(
        (r) => r.segment_id === segmentId && r.character_id === cid,
      );
      let rep: ReplacementDto;
      if (existing) {
        rep = await api.patchEpisodeReplacement(ep, existing.replacement_id, {
          replacement_text: line,
          regenerate_audio: true,
        });
      } else {
        rep = await api.createSegmentReplacement(ep, segmentId, {
          character_id: cid,
          replacement_text: line,
        });
      }
      setEpisodeReplacements((prev) => {
        const others = prev.filter(
          (r) => !(r.segment_id === segmentId && r.character_id === cid),
        );
        return [rep, ...others];
      });
      if (!options?.quiet) toast("Line audio saved to this project");
      return true;
    } catch (e) {
      if (!options?.quiet) {
        setError(e instanceof ApiError ? e.message : "Could not generate audio");
      }
      return false;
    } finally {
      setGeneratingSegmentId(null);
    }
  }

  async function generateAllAssignedTranscriptLines() {
    const ep = transcriptEpisodeId;
    if (!ep || !transcriptSegments.length) return;
    setBatchLineBusy(true);
    setError(null);
    let n = 0;
    try {
      for (const row of transcriptSegments) {
        const cid = charPickBySegment[row.segment_id];
        if (!cid) continue;
        const ch = projectRoster.find((c) => c.id === cid);
        if (!ch?.default_voice_id) continue;
        const ok = await generateLineFromTranscript(row.segment_id, row.text, {
          quiet: true,
        });
        if (ok) n += 1;
      }
      toast(
        n > 0
          ? `Generated audio for ${n} line(s) with assigned voices.`
          : "Assign a voiced character to lines first, then try again.",
      );
    } finally {
      setBatchLineBusy(false);
    }
  }

  async function generateAllLinesForSpeaker(speakerLabel: string) {
    const ep = transcriptEpisodeId;
    if (!ep || !transcriptSegments.length) return;
    setBatchLineBusy(true);
    setError(null);
    let n = 0;
    try {
      for (const row of transcriptSegments) {
        if ((row.speaker_label || "UNKNOWN") !== speakerLabel) continue;
        const cid = charPickBySegment[row.segment_id];
        if (!cid) continue;
        const ch = projectRoster.find((c) => c.id === cid);
        if (!ch?.default_voice_id) continue;
        const ok = await generateLineFromTranscript(row.segment_id, row.text, {
          quiet: true,
        });
        if (ok) n += 1;
      }
      toast(
        n > 0
          ? `Generated audio for ${n} line(s) for this speaker.`
          : "Pick a voiced character for this speaker lines first.",
      );
    } finally {
      setBatchLineBusy(false);
    }
  }

  async function handleEnableSourceVoice(
    rightsType: string,
    proofNote: string,
  ) {
    const char = sourceVoiceModalChar;
    if (!char) return;
    setSourceVoiceBusy(true);
    try {
      const updated = await api.enableSourceMatchedVoice(char.id, {
        rights_type: rightsType,
        proof_note: proofNote,
      });
      setCreatedChars((prev) => {
        const label = Object.entries(prev).find(
          ([, c]) => c.id === char.id,
        )?.[0];
        if (!label) return prev;
        return { ...prev, [label]: updated };
      });
      setProjectRoster((prev) =>
        prev.map((c) => (c.id === char.id ? updated : c)),
      );
      toast("Source-matched voice enabled.");
    } catch (e) {
      const raw = e instanceof ApiError ? e.message : String(e);
      const isPermission = /unauthori|permission|forbidden|401|403/i.test(raw);
      const msg = isPermission
        ? "Source-matched voice is not available for this workspace yet."
        : "Could not set up source-matched voice right now. Please try again later.";
      setError(msg);
      toast(msg);
    } finally {
      setSourceVoiceBusy(false);
      setSourceVoiceModalChar(null);
    }
  }

  async function handleRename(label: string, displayName: string) {
    const ep = transcriptEpisodeId;
    if (!ep || actionBusy) return;
    setActionBusy(true);
    try {
      const updated = await api.renameSpeakerGroup(ep, label, {
        display_name: displayName,
      });
      setSpeakerGroups((prev) =>
        prev.map((g) => (g.speaker_label === label ? updated : g)),
      );
      toast("Speaker renamed");
    } catch (e) {
      setSpeakerGroupsError(
        e instanceof ApiError ? e.message : "Rename failed",
      );
    } finally {
      setActionBusy(false);
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
      toast(isNarrator ? "Marked as narrator" : "Unmarked narrator");
    } catch (e) {
      setSpeakerGroupsError(
        e instanceof ApiError ? e.message : "Update failed",
      );
    }
  }

  async function handleCreateCharacter(label: string, name: string) {
    const ep = transcriptEpisodeId;
    if (!ep || !name.trim() || actionBusy) return;
    setActionBusy(true);
    setCharCreateError(null);
    try {
      const c = await api.createCharacterFromGroup(ep, label, {
        name: name.trim(),
        project_id: activeProjectId || undefined,
      });
      setCreatedChars((prev) => ({ ...prev, [label]: c }));
      toast("Character created");
    } catch (e) {
      setCharCreateError(
        e instanceof ApiError ? e.message : "Create character failed",
      );
    } finally {
      setActionBusy(false);
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
      setMergeTargetFor((prev) => {
        const next = { ...prev };
        delete next[fromLabel];
        delete next[intoLabel];
        return next;
      });
      toast("Speakers merged");
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
  }

  const visibleCastGroups = speakerGroups.filter(
    (g) => !ignoredLabels.has(g.speaker_label),
  );

  const showTranscriptSpinner =
    (!transcriptFetchDone && !transcriptError) || transcriptLoading;

  const pipelineActiveIndex = useMemo(() => {
    if (phase === "uploading") return 0;
    if (phase === "processing") return inferPipelineStep(phase, job);
    if (phase === "done" && mediaDone) {
      if (transcriptLoading || (!transcriptFetchDone && !transcriptError)) {
        return 4;
      }
      if (speakerGroupsLoading) return 4;
      return 5;
    }
    return 0;
  }, [
    phase,
    job,
    mediaDone,
    transcriptLoading,
    transcriptFetchDone,
    transcriptError,
    speakerGroupsLoading,
  ]);

  const workspaceReady = Boolean(mediaDone) && phase === "done";
  const isReImporting = importBootKind === "fresh" && (phase === "uploading" || phase === "processing");

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <Wand2 className="h-3 w-3" />
            Import workspace
          </span>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.1] tracking-tight text-foreground md:text-5xl">
            Import from Video
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Upload a video to detect speakers, extract a transcript, create characters, attach voices, and generate audio all in one workspace.
          </p>
        </div>
      </div>

      {/* ── Project pills ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Project</span>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveProjectId(p.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
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

      {/* ── Pipeline steps strip ── */}
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border bg-surface p-2.5 shadow-soft sm:grid-cols-6">
        {PIPELINE_ICONS.map((Icon, idx) => {
          const label = PIPELINE_STEPS[idx]!;
          const active = pipelineActiveIndex === idx && (phase === "uploading" || phase === "processing");
          const past = pipelineActiveIndex > idx || (phase === "done" && pipelineActiveIndex >= idx);
          return (
            <div key={label} className={`flex items-center gap-2 rounded-xl px-2.5 py-2 transition ${active ? "bg-primary/10 ring-1 ring-primary/20" : past ? "bg-emerald-500/5" : "opacity-40"}`}>
              <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : past ? "bg-emerald-500/15 text-emerald-400" : "bg-surface-sunken text-muted-foreground"}`}>
                {active ? (<><span className="absolute inset-0 rounded-lg bg-primary/30 motion-safe:animate-ping" /><Spinner className="h-3.5 w-3.5 border-t-primary-foreground" /></>) : past ? (<CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.25} />) : (<Icon className="h-3 w-3" strokeWidth={2.25} />)}
              </span>
              <span className={`text-[11px] font-semibold leading-tight ${past ? "text-emerald-400/90" : "text-foreground"}`}>{label}</span>
            </div>
          );
        })}
      </div>

      {error ? <ErrorBanner title="Request error" detail={error} /> : null}

      {isReImporting ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
              <Spinner className="h-4 w-4 border-t-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {phase === "uploading"
                  ? "Uploading new video..."
                  : job?.message || `${PIPELINE_STEPS[pipelineActiveIndex] ?? "Processing"}...`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                A new import is being processed. The current workspace stays available below.
              </p>
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            {phase === "uploading" ? (
              <div className="h-full rounded-full bg-amber-400 transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0, uploadRatio)) * 100)}%` }} />
            ) : typeof job?.progress === "number" ? (
              <div className="h-full rounded-full bg-amber-400/90 transition-[width] duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%` }} />
            ) : (
              <div className="relative h-full w-full"><div className="motion-safe:animate-pulse absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-amber-400/25 via-amber-400/80 to-amber-400/25 [animation-duration:1.3s]" /></div>
            )}
          </div>
        </div>
      ) : null}

      {importBootKind === "restored" && workspaceReady ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm text-foreground">
          Loaded your saved import for this project. Upload again to start a new run.
        </div>
      ) : null}

      {workspaceReady
        && mediaDone?.transcript_coverage_low
        && transcriptEpisodeId
        && coverageBannerDismissedFor !== transcriptEpisodeId
        ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Transcript coverage looks low for this import
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {typeof mediaDone.transcript_coverage_ratio === "number"
                  ? `Only about ${Math.round(mediaDone.transcript_coverage_ratio * 100)}% of the audio produced transcript lines. `
                  : ""}
                You can edit lines inline, or re-upload a cleaner version of the file for better results.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPersistedMedia(null);
                  setPhase("idle");
                  setImportBootKind("none");
                  setCoverageBannerDismissedFor(transcriptEpisodeId);
                }}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold text-foreground hover:border-foreground"
              >
                Try another upload
              </button>
              <button
                type="button"
                onClick={() => setCoverageBannerDismissedFor(transcriptEpisodeId)}
                className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Upload area ── */}
      {!workspaceReady ? (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-teal" />
          <div className="p-6 lg:p-8">
            <label
              htmlFor="video-upload"
              className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface-sunken/40 p-8 text-center transition-all hover:border-primary/40 hover:bg-primary/5 lg:p-10"
            >
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-glow transition-transform group-hover:scale-110">
                <UploadCloud className="h-6 w-6" strokeWidth={2} />
              </span>
              <div className="font-display text-lg font-semibold tracking-tight text-foreground">
                {file ? file.name : "Drop a video, or click to browse"}
              </div>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
                MP4, MOV, MKV, WebM, M4V or AVI. Processing runs locally on your machine.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                {["MP4", "MOV", "MKV", "WEBM", "M4V", "AVI"].map((f) => (
                  <span key={f} className="rounded-md border border-border bg-surface px-1.5 py-0.5 uppercase tracking-wider">{f}</span>
                ))}
              </div>
              <input id="video-upload" ref={inputRef} type="file" className="hidden" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v,.avi" onChange={(e) => { const fnext = e.target.files?.[0] ?? null; setFile(fnext); setImportBootKind("none"); setPhase("idle"); setJob(null); setPersistedMedia(null); setError(null); setTranscriptSegments([]); setTranscriptError(null); setTranscriptFetchDone(false); setSpeakerGroups([]); setSpeakerGroupsError(null); setSelectedTranscriptSegmentId(null); if (storageKey) { try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ } } }} />
            </label>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="text-xs text-muted-foreground">{file ? (<><span className="font-semibold text-foreground">Selected:</span> {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)</>) : "No file selected"}</div>
              <button type="button" disabled={busy || !activeProjectId || !file} onClick={() => void startUpload()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-50">
                {busy ? (<><Spinner className="h-4 w-4 border-t-primary-foreground" />{phase === "uploading" ? "Uploading…" : "Processing…"}</>) : (<><Wand2 className="h-4 w-4" />Upload and process</>)}
              </button>
            </div>
            {(phase === "uploading" || phase === "processing") && (
              <div className="mt-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10"><Spinner className="h-4 w-4 border-t-primary" /><span className="pointer-events-none absolute inset-0 motion-safe:animate-ping rounded-xl bg-primary/15 [animation-duration:2s]" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{phase === "uploading" ? "Uploading your video…" : job?.message || `${PIPELINE_STEPS[pipelineActiveIndex] ?? "Working on your import"}…`}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Keep this tab open. Processing time depends on video length.</p>
                    {phase === "processing" && processingTrust.severeStall ? (<p className="mt-1 text-[11px] text-amber-400">No server updates for several minutes. Check API logs or try again.</p>) : null}
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  {phase === "uploading" ? (<div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0, uploadRatio)) * 100)}%` }} />) : processingTrust.determinate && typeof job?.progress === "number" ? (<div className="h-full rounded-full bg-primary/90 transition-[width] duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%` }} />) : (<div className="relative h-full w-full"><div className="motion-safe:animate-pulse absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-primary/25 via-primary/80 to-primary/25 [animation-duration:1.3s]" /></div>)}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ── MAIN TWO-PANE WORKSPACE (shown after import) ── */}
      {workspaceReady ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">

          {/* ─── LEFT: Cast panel ─── */}
          <aside className="space-y-4">
            <Panel className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users className="h-4 w-4 text-accent" />
                  Detected cast
                </h2>
                {speakerGroupsLoading ? (<Spinner className="h-3.5 w-3.5 border-t-accent" />) : (<Badge tone="default">{visibleCastGroups.length} speaker{visibleCastGroups.length === 1 ? "" : "s"}{ignoredLabels.size > 0 ? ` · ${ignoredLabels.size} skipped` : ""}</Badge>)}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Rename is local to this import. Create character adds a reusable project entity. Then attach a voice in Voice Studio.
              </p>
              {speakerGroupsError ? (<div className="mt-2"><ErrorBanner title="Cast detection" detail={speakerGroupsError} /></div>) : null}
              {charCreateError ? (<div className="mt-2"><ErrorBanner title="Character creation" detail={charCreateError} /></div>) : null}

              {speakerGroupsLoading ? (<div className="mt-3 flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4 border-t-canvas" />Resolving detected cast…</div>) : null}
              {!speakerGroupsLoading && speakerGroups.length === 0 ? (<p className="mt-3 text-xs text-muted-foreground">No separate voices detected. Try a clip with clearer speaker turns, or add characters manually.</p>) : null}

              {!speakerGroupsLoading && visibleCastGroups.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {visibleCastGroups.map((g) => {
                    const created = createdChars[g.speaker_label];
                    const others = visibleCastGroups.filter((x) => x.speaker_label !== g.speaker_label).map((x) => x.speaker_label);
                    const mergePick = mergeTargetFor[g.speaker_label] ?? others[0] ?? "";
                    return (
                      <li key={g.speaker_label} id={speakerRowDomId(g.speaker_label)} className="scroll-mt-24 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06]">
                        <div className="flex items-start gap-2">
                          <Mic2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            {editingLabel === g.speaker_label ? (
                              <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void handleRename(g.speaker_label, editValue); }}>
                                <input className="min-w-[8rem] flex-1 rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1 text-sm text-text outline-none focus:border-accent/40" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                                <Button type="submit" variant="secondary">Save</Button>
                                <Button type="button" variant="secondary" onClick={() => setEditingLabel(null)}>Cancel</Button>
                              </form>
                            ) : (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="text-sm font-medium text-foreground">{g.display_name}</span>
                                {g.display_name !== g.speaker_label ? (<span className="text-[11px] text-muted-foreground">({g.speaker_label})</span>) : null}
                                {g.is_narrator ? (<Badge tone="violet">narrator</Badge>) : null}
                              </div>
                            )}
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{g.segment_count} segments · {g.total_speaking_duration.toFixed(1)}s</p>
                          </div>
                        </div>

                        {created ? (
                          <div className="mt-2.5 space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Character created
                              {created.voice_display_name ? (
                                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                  Voice: {created.voice_display_name}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {!created.default_voice_id ? (
                                <Link href={`/voice-studio?character=${encodeURIComponent(created.id)}&panel=voice&focus=attach`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground shadow-glow transition hover:opacity-90">
                                  <Volume2 className="h-3 w-3" />Attach voice
                                </Link>
                              ) : (
                                <Link href={`/voice-studio?character=${encodeURIComponent(created.id)}&panel=voice`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-white/[0.08] px-2.5 text-[11px] font-semibold text-foreground ring-1 ring-white/[0.1] transition hover:bg-white/[0.12]">
                                  Voice Studio
                                </Link>
                              )}
                              <Button variant="secondary" className="!h-8 !px-2 !text-[11px]" onClick={() => { setEditingLabel(g.speaker_label); setEditValue(g.display_name); }}>
                                <Pencil className="h-3 w-3" />Rename
                              </Button>
                            </div>
                            {anyCharacterHasVoice && transcriptFetchDone && !transcriptError ? (
                              <button type="button" className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-foreground ring-1 ring-white/[0.1] hover:bg-white/[0.1] disabled:opacity-50" disabled={batchLineBusy || generatingSegmentId != null} onClick={() => void generateAllLinesForSpeaker(g.speaker_label)}>
                                Generate all lines for this speaker
                              </button>
                            ) : null}
                          </div>
                        ) : creatingLabel === g.speaker_label ? (
                          <form className="mt-2.5 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void handleCreateCharacter(g.speaker_label, charNameInput); }}>
                            <input className="min-w-[8rem] flex-1 rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1.5 text-sm text-text outline-none focus:border-accent/40" placeholder="Character name" value={charNameInput} onChange={(e) => setCharNameInput(e.target.value)} autoFocus />
                            <Button type="submit" disabled={!charNameInput.trim()}>Save</Button>
                            <Button type="button" variant="secondary" onClick={() => setCreatingLabel(null)}>Cancel</Button>
                          </form>
                        ) : (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <Button variant="secondary" className="!h-8 !px-2 !text-[11px]" onClick={() => { setCreatingLabel(g.speaker_label); setCharNameInput(g.display_name !== g.speaker_label ? g.display_name : ""); }}>
                              <UserPlus className="h-3 w-3" />Create character
                            </Button>
                            <Button variant="secondary" className="!h-8 !px-2 !text-[11px]" onClick={() => { setEditingLabel(g.speaker_label); setEditValue(g.display_name); }}>
                              <Pencil className="h-3 w-3" />Rename
                            </Button>
                            <Button variant="secondary" className="!h-8 !px-2 !text-[11px]" onClick={() => toggleIgnore(g.speaker_label)}>Skip</Button>
                          </div>
                        )}

                        {editingLabel !== g.speaker_label ? (
                          <details className="group mt-2 border-t border-white/[0.06] pt-2">
                            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                              <MoreHorizontal className="h-3 w-3" />More
                            </summary>
                            <div className="mt-2 flex flex-col gap-2">
                              <Button type="button" variant="secondary" className="w-full justify-start !px-2 !py-1 !text-[11px]" onClick={() => void handleNarrator(g.speaker_label, !g.is_narrator)}>
                                {g.is_narrator ? "Unmark narrator" : "Mark narrator / off-screen"}
                              </Button>
                              {created && created.source_episode_id && created.source_speaker_labels?.length > 0 && !created.source_matched_voice_enabled && !created.default_voice_id ? (
                                <button type="button" className="w-full rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-left text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/10" onClick={() => setSourceVoiceModalChar(created)}>
                                  <Mic2 className="mr-1 inline h-3 w-3" />Use source-matched voice (advanced)
                                </button>
                              ) : null}
                              {others.length > 0 ? (
                                <div className="space-y-1">
                                  <p className="text-[10px] text-muted-foreground">If this is the same person as another detected speaker, merge them together.</p>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] text-muted-foreground">Merge into</span>
                                    <select className="rounded-lg border border-white/[0.12] bg-canvas/80 px-1.5 py-1 text-[11px] text-text outline-none" value={mergePick} onChange={(e) => setMergeTargetFor((m) => ({ ...m, [g.speaker_label]: e.target.value }))}>
                                      {others.map((lab) => { const og = speakerGroups.find((x) => x.speaker_label === lab); return (<option key={lab} value={lab}>{og?.display_name ?? lab}</option>); })}
                                    </select>
                                    <Button type="button" variant="secondary" className="!px-2 !py-0.5 !text-[11px]" disabled={mergeBusy || !mergePick} onClick={() => void runMerge(g.speaker_label, mergePick)}>
                                      <GitMerge className="h-3 w-3" />Merge
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {ignoredLabels.size > 0 ? (
                <details className="mt-3 rounded-xl bg-white/[0.02] p-2 ring-1 ring-white/[0.06]">
                  <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">Skipped ({ignoredLabels.size})</summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">{[...ignoredLabels].map((lab) => (<button key={lab} type="button" className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-white/[0.08] hover:bg-white/[0.1]" onClick={() => toggleIgnore(lab)}>Restore {lab}</button>))}</div>
                </details>
              ) : null}
            </Panel>

            {/* Re-upload */}
            <details className="rounded-2xl border border-border bg-card p-3 shadow-soft">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                Upload a new video
              </summary>
              <div className="mt-3">
                <label htmlFor="video-upload-re" className="group flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface-sunken/40 p-4 text-center hover:border-primary/40 hover:bg-primary/5">
                  <UploadCloud className="h-5 w-5 text-primary" />
                  <span className="text-xs font-medium text-foreground">{file ? file.name : "Choose file"}</span>
                  <input id="video-upload-re" type="file" className="hidden" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v,.avi" onChange={(e) => { const fnext = e.target.files?.[0] ?? null; setFile(fnext); }} />
                </label>
                <button type="button" disabled={busy || isReImporting || !activeProjectId || !file} onClick={() => void startUpload()} className="mt-2 w-full rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                  {busy || isReImporting ? "Import in progress..." : "Upload and process"}
                </button>
              </div>
            </details>

            {/* Episode switcher */}
            {projectEpisodes.length > 0 ? (
              <div className="rounded-2xl border border-border bg-card p-3 shadow-soft">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Imported videos ({projectEpisodes.length})
                  {isReImporting ? <span className="ml-1 text-amber-400">+1 importing...</span> : null}
                </p>
                <div className="space-y-1">
                  {projectEpisodes.map((ep) => {
                    const active = transcriptEpisodeId === ep.id;
                    const label = ep.title || (ep.source_video_path ? ep.source_video_path.split("/").pop() : null) || ep.id.slice(0, 8);
                    const date = ep.updated_at ? new Date(ep.updated_at).toLocaleDateString() : "";
                    return (
                      <button key={ep.id} type="button" onClick={() => { if (!active) switchToEpisode(ep); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs ${active ? "bg-primary/10 font-semibold text-primary ring-1 ring-primary/20" : "text-foreground hover:bg-white/[0.06]"}`}>
                        <span className="truncate flex-1">{label}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{date}</span>
                        {active ? <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold text-primary">Active</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </aside>

          {/* ─── RIGHT: Transcript workspace ─── */}
          <main className="space-y-4">
            <Panel className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Transcript</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {mediaDone?.duration_sec != null ? `${mediaDone.duration_sec.toFixed(0)}s` : ""}
                    {mediaDone?.transcript_language ? ` · ${spokenLanguageUiLabel(mediaDone.transcript_language)}` : ""}
                    {transcriptFetchDone ? ` · ${transcriptSegments.length} segments` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {showTranscriptSpinner ? (<Badge tone="accent">Loading…</Badge>) : null}
                  {anyCharacterHasVoice && transcriptFetchDone && !transcriptError && transcriptSegments.length > 0 ? (
                    <button type="button" className="rounded-lg bg-primary/90 px-3 py-1.5 text-[11px] font-semibold text-primary-foreground ring-1 ring-primary/30 disabled:opacity-50" disabled={batchLineBusy || generatingSegmentId != null} onClick={() => void generateAllAssignedTranscriptLines()}>
                      {batchLineBusy ? "Batch working…" : "Generate all assigned lines"}
                    </button>
                  ) : null}
                </div>
              </div>

              {transcriptError ? (<div className="mt-3"><ErrorBanner title="Transcript error" detail={transcriptError} /></div>) : null}
              {showTranscriptSpinner && !transcriptError ? (<div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4 border-t-canvas" />Loading transcript…</div>) : null}
              {transcriptFetchDone && !transcriptError && transcriptSegments.length === 0 ? (<p className="mt-3 text-sm text-muted-foreground">No transcript segments (silent clip or model returned empty).</p>) : null}

              {transcriptFetchDone && transcriptSegments.length > 0 ? (
                <ul className="mt-3 max-h-[calc(100vh-280px)] space-y-1 overflow-y-auto rounded-lg bg-white/[0.015] p-1.5 ring-1 ring-white/[0.05]">
                  {transcriptSegments.map((row) => {
                    const group = speakerGroups.find((g) => g.speaker_label === row.speaker_label);
                    const label = group?.display_name ?? row.speaker_label ?? "Unknown";
                    const ep = transcriptEpisodeId;
                    const sel = selectedTranscriptSegmentId === row.segment_id;
                    const segRep = episodeReplacements.find((r) => r.segment_id === row.segment_id);
                    return (
                      <li key={row.segment_id} ref={editSegmentId === row.segment_id ? editRowRef : undefined} className={`rounded-lg text-sm transition ${sel ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-white/[0.02]"}`}>
                        <div className="flex gap-2 px-2.5 py-2">
                          <div className="min-w-0 flex-1">
                            <button type="button" className="w-full text-left" onClick={() => setSelectedTranscriptSegmentId(row.segment_id)}>
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-mono text-[11px] text-muted-foreground">{formatTimecode(row.start_time)}</span>
                                <Badge tone={group?.is_narrator ? "violet" : row.speaker_label?.startsWith("SPEAKER_") ? "accent" : "default"}>{label}</Badge>
                              </div>
                              <p className="mt-0.5 text-[13px] leading-snug text-foreground">{row.text}</p>
                            </button>
                            {segRep?.audio_url ? (
                              <div className="mt-1.5 flex items-center gap-2">
                                <audio controls className="h-7 max-w-[200px]" src={mediaUrl(segRep.audio_url.replace(/^\/media\//, ""))} />
                                <Badge tone="success">Generated</Badge>
                              </div>
                            ) : null}
                          </div>
                          {ep ? (
                            <div className="flex shrink-0 flex-col items-end gap-1 self-start">
                              {/* Play source audio */}
                              <button type="button" title="Play source audio" className={`flex h-7 w-7 items-center justify-center rounded-md transition ${playingSourceSegId === row.segment_id ? "bg-primary text-primary-foreground" : "bg-white/[0.06] text-muted-foreground ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-foreground"}`} onClick={(e: MouseEvent) => { e.stopPropagation(); playSourceSegment(ep, row.segment_id); }}>
                                {playingSourceSegId === row.segment_id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              </button>
                              {anyCharacterHasVoice ? (
                                <>
                                  <select className="max-w-[10rem] rounded-md border border-white/[0.1] bg-canvas/80 px-1.5 py-0.5 text-[11px] text-foreground" value={charPickBySegment[row.segment_id] ?? ""} onChange={(e) => { setCharPickBySegment((prev) => ({ ...prev, [row.segment_id]: e.target.value })); }} onClick={(e: MouseEvent) => e.stopPropagation()}>
                                    <option value="">Character…</option>
                                    {projectRoster.filter((c) => c.default_voice_id).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                  </select>
                                  <button type="button" className="rounded-md bg-primary/90 px-2 py-0.5 text-[11px] font-semibold text-primary-foreground ring-1 ring-primary/30 disabled:opacity-50" disabled={generatingSegmentId === row.segment_id || batchLineBusy} onClick={(e: MouseEvent) => { e.stopPropagation(); void generateLineFromTranscript(row.segment_id, row.text); }}>
                                    {generatingSegmentId === row.segment_id ? "Working…" : "Generate"}
                                  </button>
                                  <button type="button" className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-white/[0.08] hover:bg-white/[0.1]" onClick={(e: MouseEvent) => { e.stopPropagation(); if (editSegmentId === row.segment_id) { setEditSegmentId(null); setEditSegmentDraft(""); } else { setEditSegmentId(row.segment_id); setEditSegmentDraft(row.text); } }}>
                                    {editSegmentId === row.segment_id ? "Close" : "Edit"}
                                  </button>
                                </>
                              ) : null}
                              <Link href={`/replace-lines?episode=${encodeURIComponent(ep)}&segment=${encodeURIComponent(row.segment_id)}`} className="text-[10px] font-medium text-muted-foreground hover:text-foreground hover:underline" onClick={(e: MouseEvent) => e.stopPropagation()}>
                                Replace Lines
                              </Link>
                              <button type="button" className="text-[10px] font-medium text-red-400/60 hover:text-red-400 hover:underline" onClick={(e: MouseEvent) => { e.stopPropagation(); void handleDeleteSegment(row.segment_id); }}>
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {editSegmentId === row.segment_id ? (
                          <div className="border-t border-white/[0.06] px-2.5 py-2">
                            <textarea className="w-full rounded-md border border-white/[0.12] bg-canvas/80 px-2 py-1.5 text-[13px] text-foreground" rows={2} value={editSegmentDraft} onChange={(e) => setEditSegmentDraft(e.target.value)} />
                            <button type="button" className="mt-1.5 rounded-md bg-primary/90 px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50" disabled={generatingSegmentId === row.segment_id || batchLineBusy} onClick={() => void generateLineFromTranscript(row.segment_id, editSegmentDraft)}>
                              {generatingSegmentId === row.segment_id ? "Generating…" : "Generate edited line"}
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </Panel>

            {/* Replace Lines CTA */}
            {transcriptEpisodeId && transcriptSegments.length > 0 ? (
              <div className={`rounded-xl px-4 py-3 ${anyCharacterHasVoice ? "border border-emerald-500/25 bg-emerald-500/5" : "border border-white/[0.08] bg-white/[0.02]"}`}>
                {anyCharacterHasVoice ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Voices assigned. You can also use the advanced Replace Lines tool.</p>
                    <Link href={`/replace-lines?episode=${encodeURIComponent(transcriptEpisodeId)}`} className="text-sm font-semibold text-accent underline-offset-4 hover:underline">Open Replace Lines</Link>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Assign a voice to a character first. Then generate audio inline or use Replace Lines for advanced editing.</p>
                )}
              </div>
            ) : null}

            {/* Frames and downloads */}
            {mediaDone ? (
              <Panel className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                <details open>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[open]>&]:rotate-180" />
                    Frames and downloads
                  </summary>
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {mediaDone.thumbnail_paths.map((rel, i) => (
                      <div key={rel} className="overflow-hidden rounded-lg ring-1 ring-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={mediaUrl(rel)} alt={`Frame ${i + 1}`} className="h-20 w-full object-cover" />
                        <div className="flex flex-col gap-0.5 border-t border-white/[0.06] bg-black/20 px-1.5 py-1">
                          <a href={mediaUrl(rel)} download={`castweave-frame-${i + 1}.jpg`} className="text-[10px] font-medium text-accent hover:underline">Download</a>
                          {transcriptEpisodeId && projectRoster.length > 0 ? (
                            <select
                              className="w-full rounded border border-white/[0.1] bg-canvas/80 px-0.5 py-0.5 text-[10px] text-foreground disabled:opacity-50"
                              defaultValue=""
                              disabled={avatarBusyIndex === i}
                              onChange={(e) => {
                                const cid = e.target.value;
                                if (!cid || !transcriptEpisodeId) return;
                                if (avatarBusyIndex !== null) { e.target.value = ""; return; }
                                const selectEl = e.target;
                                setAvatarBusyIndex(i);
                                void (async () => {
                                  try {
                                    await api.setCharacterAvatarFromEpisodeThumb(cid, { episode_id: transcriptEpisodeId, thumb_index: i });
                                    toast("Character photo updated");
                                  } catch {
                                    toast("Could not update character photo");
                                  } finally {
                                    selectEl.value = "";
                                    setAvatarBusyIndex(null);
                                  }
                                })();
                              }}
                            >
                              <option value="">{avatarBusyIndex === i ? "Updating..." : "Use as character photo..."}</option>
                              {projectRoster.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                            </select>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  {transcriptEpisodeId ? (
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-medium">
                      <a href={api.episodeTranscriptExportUrl(transcriptEpisodeId, "txt")} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline"><Download className="h-3 w-3" />Transcript .txt</a>
                      <a href={api.episodeTranscriptExportUrl(transcriptEpisodeId, "srt")} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline"><Download className="h-3 w-3" />Subtitles .srt</a>
                      <a href={api.episodeTranscriptExportUrl(transcriptEpisodeId, "vtt")} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline"><Download className="h-3 w-3" />Subtitles .vtt</a>
                      {activeProjectId && projectClipCount > 0 ? (
                        <a href={api.projectClipsZipUrl(activeProjectId)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline"><Download className="h-3 w-3" />All clips .zip ({projectClipCount})</a>
                      ) : activeProjectId ? (
                        <span className="text-muted-foreground">No generated clips yet</span>
                      ) : null}
                    </div>
                  ) : null}
                </details>
              </Panel>
            ) : null}
          </main>
        </div>
      ) : null}

      <footer className="mt-10 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
        CastWeave · Video to cast, voice, and lines.
      </footer>

      {sourceVoiceModalChar ? (
        <SourceVoiceModal
          characterName={sourceVoiceModalChar.name}
          busy={sourceVoiceBusy}
          onConfirm={handleEnableSourceVoice}
          onCancel={() => setSourceVoiceModalChar(null)}
        />
      ) : null}

      <ConfirmModal
        open={!!confirmDeleteSegId}
        title="Remove transcript line"
        confirmLabel="Remove"
        danger
        onConfirm={() => void executeDeleteSegment()}
        onCancel={() => setConfirmDeleteSegId(null)}
      >
        <p>Remove this line from the transcript? It will be hidden from exports and generation.</p>
      </ConfirmModal>
    </div>
  );
}
