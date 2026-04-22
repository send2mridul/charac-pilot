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
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  FileVideo,
  Film,
  GitMerge,
  Layers,
  Mic2,
  MoreHorizontal,
  Package,
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

type HindiTranscriptViewMode = "roman" | "devanagari";

function storageKeyForHindiTranscriptView(episodeId: string): string {
  return `castweave:hindi-transcript-view:${episodeId}`;
}

function isHindiTranscriptLanguage(code: string | null | undefined): boolean {
  if (code == null || String(code).trim() === "") return false;
  const s = String(code).trim().toLowerCase();
  const b = s.split("-")[0] ?? "";
  return b === "hi" || s === "hindi";
}

/**
 * Same transcript line in two display forms: Devanagari when `text_original` exists,
 * else Roman `text` for both modes.
 */
function hindiPrimaryDisplayText(
  seg: TranscriptSegmentDto,
  mode: HindiTranscriptViewMode,
): string {
  if (mode === "devanagari") {
    const o = seg.text_original?.trim();
    if (o) return o;
  }
  return (seg.text ?? "").trim();
}

function speakerRowDomId(label: string): string {
  return `spk-${label.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

function episodeImportLabel(ep: EpisodeDto): string {
  const t = ep.title?.trim();
  if (t) return t;
  const path = ep.source_video_path?.trim();
  if (path) {
    const parts = path.split(/[/\\]/);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return ep.id.slice(0, 8);
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
  const searchParams = useSearchParams();
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
  const [lineEditorDraft, setLineEditorDraft] = useState("");
  const [lineEditorTone, setLineEditorTone] = useState("");
  /** Hindi imports only: Hindi script (default) vs Roman helper (persisted per episode). */
  const [hindiTranscriptViewMode, setHindiTranscriptViewMode] =
    useState<HindiTranscriptViewMode>("devanagari");
  const [saveTextBusy, setSaveTextBusy] = useState(false);
  const lineListRef = useRef<HTMLUListElement>(null);
  const [generatingSegmentId, setGeneratingSegmentId] = useState<string | null>(
    null,
  );
  const [batchLineBusy, setBatchLineBusy] = useState(false);
  const [sourceVoiceModalChar, setSourceVoiceModalChar] =
    useState<CharacterDto | null>(null);
  const [sourceVoiceBusy, setSourceVoiceBusy] = useState(false);
  const [confirmDeleteSegId, setConfirmDeleteSegId] = useState<string | null>(null);
  const [playingSourceSegId, setPlayingSourceSegId] = useState<string | null>(null);
  const [playingGeneratedSegId, setPlayingGeneratedSegId] = useState<string | null>(null);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const generatedAudioRef = useRef<HTMLAudioElement | null>(null);
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
          setSelectedTranscriptSegmentId(null);
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

  const activeEpisodeRecord = useMemo(
    () =>
      transcriptEpisodeId
        ? projectEpisodes.find((e) => e.id === transcriptEpisodeId)
        : undefined,
    [projectEpisodes, transcriptEpisodeId],
  );

  const isHindiTranscriptImport = useMemo(
    () =>
      isHindiTranscriptLanguage(
        mediaDone?.transcript_language ??
          activeEpisodeRecord?.transcript_language,
      ),
    [mediaDone?.transcript_language, activeEpisodeRecord?.transcript_language],
  );

  const hindiViewModeStorageKey =
    transcriptEpisodeId && isHindiTranscriptImport
      ? storageKeyForHindiTranscriptView(transcriptEpisodeId)
      : null;

  useEffect(() => {
    if (!hindiViewModeStorageKey) return;
    try {
      const v = window.localStorage.getItem(hindiViewModeStorageKey);
      if (v === "devanagari" || v === "roman") {
        setHindiTranscriptViewMode(v);
        return;
      }
    } catch {
      /* ignore */
    }
    setHindiTranscriptViewMode("devanagari");
  }, [hindiViewModeStorageKey]);

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
    if (!selectedTranscriptSegmentId) return;
    const el = document.getElementById(`seg-${selectedTranscriptSegmentId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedTranscriptSegmentId]);

  useEffect(() => {
    if (!transcriptFetchDone || transcriptError || transcriptSegments.length === 0) {
      return;
    }
    const exists = transcriptSegments.some(
      (s) => s.segment_id === selectedTranscriptSegmentId,
    );
    if (!selectedTranscriptSegmentId || !exists) {
      setSelectedTranscriptSegmentId(transcriptSegments[0]!.segment_id);
    }
  }, [
    transcriptFetchDone,
    transcriptError,
    transcriptSegments,
    selectedTranscriptSegmentId,
  ]);

  const episodeUrlParam = searchParams.get("episode");
  useEffect(() => {
    if (!episodeUrlParam || !activeProjectId || phase !== "done") return;
    const ep = projectEpisodes.find((e) => e.id === episodeUrlParam);
    if (!ep) return;
    if (transcriptEpisodeId === ep.id) return;
    switchToEpisode(ep);
  }, [episodeUrlParam, activeProjectId, phase, projectEpisodes, transcriptEpisodeId]);

  useEffect(() => {
    if (!selectedTranscriptSegmentId) {
      setLineEditorDraft("");
      setLineEditorTone("");
      return;
    }
    const row = transcriptSegments.find(
      (s) => s.segment_id === selectedTranscriptSegmentId,
    );
    if (!row) return;
    const primary = isHindiTranscriptImport
      ? hindiPrimaryDisplayText(row, hindiTranscriptViewMode)
      : row.text;
    setLineEditorDraft(primary);
    const cid = charPickBySegment[selectedTranscriptSegmentId] ?? "";
    const rep = episodeReplacements.find(
      (r) =>
        r.segment_id === selectedTranscriptSegmentId &&
        (!cid || r.character_id === cid),
    );
    setLineEditorTone((rep?.tone_style ?? "").trim());
  }, [
    selectedTranscriptSegmentId,
    transcriptSegments,
    episodeReplacements,
    charPickBySegment,
    isHindiTranscriptImport,
    hindiTranscriptViewMode,
  ]);

  function switchToEpisode(ep: EpisodeDto) {
    if (sourceAudioRef.current) { sourceAudioRef.current.pause(); sourceAudioRef.current = null; }
    setPlayingSourceSegId(null);
    if (generatedAudioRef.current) {
      generatedAudioRef.current.pause();
      generatedAudioRef.current = null;
    }
    setPlayingGeneratedSegId(null);
    const media: EpisodeMediaJobResult = {
      episode_id: ep.id,
      project_id: ep.project_id,
      source_video_path: ep.source_video_path ?? "",
      extracted_audio_path: ep.extracted_audio_path ?? "",
      thumbnail_paths: ep.thumbnail_paths ?? [],
      duration_sec: ep.duration_sec ?? undefined,
      transcript_segment_count: ep.segment_count,
      transcript_language: ep.transcript_language ?? undefined,
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
      setTranscriptSegments((prev) => {
        const next = prev.filter((s) => s.segment_id !== segId);
        setSelectedTranscriptSegmentId((sel) => {
          if (sel !== segId) return sel;
          return next[0]?.segment_id ?? null;
        });
        return next;
      });
      setEpisodeReplacements((prev) =>
        prev.filter((r) => r.segment_id !== segId),
      );
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
    if (generatedAudioRef.current) {
      generatedAudioRef.current.pause();
      generatedAudioRef.current = null;
      setPlayingGeneratedSegId(null);
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

  function playGeneratedSegment(segmentId: string) {
    const ep = transcriptEpisodeId;
    if (!ep) return;
    const cid = charPickBySegment[segmentId] ?? "";
    const rep = episodeReplacements.find(
      (r) =>
        r.segment_id === segmentId && (!cid || r.character_id === cid),
    );
    if (!rep?.audio_url) {
      toast("Generate audio for this line first.");
      return;
    }
    if (playingGeneratedSegId === segmentId) {
      generatedAudioRef.current?.pause();
      setPlayingGeneratedSegId(null);
      return;
    }
    if (generatedAudioRef.current) {
      generatedAudioRef.current.pause();
      generatedAudioRef.current = null;
    }
    if (sourceAudioRef.current) {
      sourceAudioRef.current.pause();
      sourceAudioRef.current = null;
      setPlayingSourceSegId(null);
    }
    const url = mediaUrl(rep.audio_url.replace(/^\/media\//, ""));
    const audio = new Audio(url);
    generatedAudioRef.current = audio;
    setPlayingGeneratedSegId(segmentId);
    audio.onended = () => {
      setPlayingGeneratedSegId(null);
      generatedAudioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingGeneratedSegId(null);
      generatedAudioRef.current = null;
      toast("Could not play generated audio");
    };
    audio.play().catch(() => {
      setPlayingGeneratedSegId(null);
      generatedAudioRef.current = null;
    });
  }

  async function saveLineTextOnly(): Promise<void> {
    const ep = transcriptEpisodeId;
    const sid = selectedTranscriptSegmentId;
    if (!ep || !sid || saveTextBusy) return;
    const t = lineEditorDraft.trim();
    if (!t) {
      toast("Add text before saving");
      return;
    }
    const row = transcriptSegments.find((s) => s.segment_id === sid);
    const priorPrimary = row
      ? isHindiTranscriptImport
        ? hindiPrimaryDisplayText(row, hindiTranscriptViewMode)
        : row.text
      : "";
    if (row && priorPrimary.trim() === t) {
      toast("No changes to save");
      return;
    }
    setSaveTextBusy(true);
    setError(null);
    try {
      const updated = await api.patchTranscriptSegmentText(ep, sid, { text: t });
      setTranscriptSegments((prev) =>
        prev.map((s) => (s.segment_id === sid ? updated : s)),
      );
      toast("Line text saved");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save text");
    } finally {
      setSaveTextBusy(false);
    }
  }

  async function generateLineFromTranscript(
    segmentId: string,
    text: string,
    options?: { quiet?: boolean; tone_style?: string | null },
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
      const toneRaw =
        options?.tone_style !== undefined
          ? options.tone_style
          : segmentId === selectedTranscriptSegmentId
            ? lineEditorTone.trim()
            : "";
      const tone_style = toneRaw ? toneRaw : undefined;
      const existing = episodeReplacements.find(
        (r) => r.segment_id === segmentId && r.character_id === cid,
      );
      let rep: ReplacementDto;
      if (existing) {
        rep = await api.patchEpisodeReplacement(ep, existing.replacement_id, {
          replacement_text: line,
          tone_style: tone_style ?? existing.tone_style ?? undefined,
          regenerate_audio: true,
        });
      } else {
        rep = await api.createSegmentReplacement(ep, segmentId, {
          character_id: cid,
          replacement_text: line,
          tone_style,
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
        const existing = episodeReplacements.find(
          (r) => r.segment_id === row.segment_id && r.character_id === cid,
        );
        const ok = await generateLineFromTranscript(row.segment_id, row.text, {
          quiet: true,
          tone_style: existing?.tone_style ?? undefined,
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
        const existing = episodeReplacements.find(
          (r) => r.segment_id === row.segment_id && r.character_id === cid,
        );
        const ok = await generateLineFromTranscript(row.segment_id, row.text, {
          quiet: true,
          tone_style: existing?.tone_style ?? undefined,
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

  const selectedSeg = useMemo(
    () =>
      transcriptSegments.find((s) => s.segment_id === selectedTranscriptSegmentId) ??
      null,
    [transcriptSegments, selectedTranscriptSegmentId],
  );

  const lineEditorReplacement = useMemo(() => {
    if (!selectedTranscriptSegmentId) return null;
    const cid = charPickBySegment[selectedTranscriptSegmentId] ?? "";
    return (
      episodeReplacements.find(
        (r) =>
          r.segment_id === selectedTranscriptSegmentId &&
          (!cid || r.character_id === cid),
      ) ?? null
    );
  }, [selectedTranscriptSegmentId, charPickBySegment, episodeReplacements]);

  const episodeReplacementsForWorkspace = useMemo(
    () =>
      transcriptEpisodeId
        ? episodeReplacements.filter((r) => r.episode_id === transcriptEpisodeId)
        : [],
    [episodeReplacements, transcriptEpisodeId],
  );

  const selectedCharIdForLine = selectedSeg
    ? (charPickBySegment[selectedSeg.segment_id] ?? "")
    : "";
  const selectedCharHasVoice = Boolean(
    selectedCharIdForLine &&
      projectRoster.find((c) => c.id === selectedCharIdForLine)?.default_voice_id,
  );
  const canGenerateSelectedLine = Boolean(
    selectedSeg && transcriptEpisodeId && selectedCharHasVoice,
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div className="max-w-4xl">
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

      {/* ── MAIN IMPORT EDITOR (workspace + cast + transcript) ── */}
      {workspaceReady ? (
        <div className="space-y-6">
          <Panel className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Active import
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-foreground">
                  {activeEpisodeRecord
                    ? episodeImportLabel(activeEpisodeRecord)
                    : mediaDone?.source_video_path
                      ? mediaDone.source_video_path.split(/[/\\]/).pop() || "Import"
                      : "Import"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mediaDone?.duration_sec != null
                    ? `${Math.round(mediaDone.duration_sec)}s runtime`
                    : ""}
                  {mediaDone?.transcript_language
                    ? ` · ${spokenLanguageUiLabel(mediaDone.transcript_language)}`
                    : ""}
                  {transcriptFetchDone
                    ? ` · ${transcriptSegments.length} transcript lines`
                    : transcriptLoading
                      ? " · Loading transcript…"
                      : ""}
                  {speakerGroups.length > 0
                    ? ` · ${visibleCastGroups.length} cast speaker${visibleCastGroups.length === 1 ? "" : "s"}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {isReImporting ? (
                  <Badge tone="accent">New import running…</Badge>
                ) : (
                  <Badge tone="success">Workspace ready</Badge>
                )}
                {transcriptEpisodeId ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold">
                    <a
                      href={api.episodeTranscriptExportUrl(transcriptEpisodeId, "txt")}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Transcript .txt
                    </a>
                    <a
                      href={api.episodeTranscriptExportUrl(transcriptEpisodeId, "srt")}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      .srt
                    </a>
                    <a
                      href={api.episodeTranscriptExportUrl(transcriptEpisodeId, "vtt")}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      .vtt
                    </a>
                    {activeProjectId && projectClipCount > 0 ? (
                      <a
                        href={api.projectClipsZipUrl(activeProjectId)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Package className="h-3.5 w-3.5" />
                        Clips .zip ({projectClipCount})
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {projectEpisodes.length > 0 ? (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Episodes in this project ({projectEpisodes.length})
                  {isReImporting ? (
                    <span className="ml-2 font-normal normal-case text-amber-600 dark:text-amber-400">
                      +1 importing…
                    </span>
                  ) : null}
                </p>
                <div className="flex max-w-full flex-wrap gap-1.5 overflow-x-auto pb-1">
                  {projectEpisodes.map((ep) => {
                    const active = transcriptEpisodeId === ep.id;
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => {
                          if (!active) switchToEpisode(ep);
                        }}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-left text-xs font-semibold transition ${
                          active
                            ? "bg-primary text-primary-foreground shadow-glow ring-1 ring-primary/30"
                            : "border border-border bg-surface text-foreground hover:border-primary/40 hover:bg-primary/5"
                        }`}
                      >
                        <span className="block max-w-[14rem] truncate">
                          {episodeImportLabel(ep)}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-normal opacity-80">
                          {ep.segment_count} lines
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <details className="group mt-4 rounded-xl border border-border bg-surface-sunken/30 p-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                <UploadCloud className="h-4 w-4 text-primary" />
                Upload a new video or replace this run
                <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-open:rotate-180" />
              </summary>
              <div className="mt-3">
                <label
                  htmlFor="video-upload-re"
                  className="group flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-4 text-center hover:border-primary/40 hover:bg-primary/5"
                >
                  <span className="text-xs font-medium text-foreground">
                    {file ? file.name : "Choose file"}
                  </span>
                  <input
                    id="video-upload-re"
                    type="file"
                    className="hidden"
                    accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm,.m4v,.avi"
                    onChange={(e) => {
                      const fnext = e.target.files?.[0] ?? null;
                      setFile(fnext);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || isReImporting || !activeProjectId || !file}
                  onClick={() => void startUpload()}
                  className="mt-2 w-full rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy || isReImporting ? "Import in progress…" : "Upload and process"}
                </button>
              </div>
            </details>
          </Panel>

          <div className="flex w-full min-w-0 flex-col gap-10">
          <div className="flex w-full min-w-0 flex-col gap-6 xl:flex-row xl:items-start xl:gap-8">
          {/* ─── LEFT: Cast (~280–320px) ─── */}
          <aside className="w-full shrink-0 space-y-4 xl:w-[20rem] xl:min-w-[17.5rem] xl:max-w-[20rem]">
            <Panel className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Users className="h-5 w-5 text-accent" />
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
          </aside>

          {/* CENTER: transcript (flexible width) */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col space-y-4">
            <Panel className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                    <FileText className="h-5 w-5 text-primary" />
                    Transcript
                  </h2>
                  <p className="mt-1 max-w-md text-sm leading-relaxed text-foreground/85">
                    Click a line to select it. Edit text, save, and play source audio in the right
                    panel. You do not need a voice to fix the transcript.
                  </p>
                  {isHindiTranscriptImport ? (
                    <div className="mt-4 max-w-xl rounded-xl border border-border bg-surface-sunken/50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Hindi transcript display
                      </p>
                      <div className="mt-2 inline-flex rounded-lg border border-border bg-card p-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setHindiTranscriptViewMode("devanagari");
                            if (transcriptEpisodeId) {
                              try {
                                window.localStorage.setItem(
                                  storageKeyForHindiTranscriptView(transcriptEpisodeId),
                                  "devanagari",
                                );
                              } catch {
                                /* ignore */
                              }
                            }
                            if (selectedTranscriptSegmentId) {
                              const row = transcriptSegments.find(
                                (s) => s.segment_id === selectedTranscriptSegmentId,
                              );
                              if (row) {
                                setLineEditorDraft(
                                  hindiPrimaryDisplayText(row, "devanagari"),
                                );
                              }
                            }
                          }}
                          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                            hindiTranscriptViewMode === "devanagari"
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-foreground/80 hover:bg-white/[0.06]"
                          }`}
                        >
                          Hindi script
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setHindiTranscriptViewMode("roman");
                            if (transcriptEpisodeId) {
                              try {
                                window.localStorage.setItem(
                                  storageKeyForHindiTranscriptView(transcriptEpisodeId),
                                  "roman",
                                );
                              } catch {
                                /* ignore */
                              }
                            }
                            if (selectedTranscriptSegmentId) {
                              const row = transcriptSegments.find(
                                (s) => s.segment_id === selectedTranscriptSegmentId,
                              );
                              if (row) {
                                setLineEditorDraft(
                                  hindiPrimaryDisplayText(row, "roman"),
                                );
                              }
                            }
                          }}
                          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                            hindiTranscriptViewMode === "roman"
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-foreground/80 hover:bg-white/[0.06]"
                          }`}
                        >
                          Roman Hindi (helper)
                        </button>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Hindi script is the default view when Devanagari exists for a line. Roman
                        Hindi is an optional readable view of the same line, not a different
                        transcript.
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {showTranscriptSpinner ? <Badge tone="accent">Loading…</Badge> : null}
                  {anyCharacterHasVoice &&
                  transcriptFetchDone &&
                  !transcriptError &&
                  transcriptSegments.length > 0 ? (
                    <button
                      type="button"
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow ring-1 ring-primary/30 transition hover:opacity-95 disabled:opacity-50"
                      disabled={batchLineBusy || generatingSegmentId != null}
                      onClick={() => void generateAllAssignedTranscriptLines()}
                    >
                      {batchLineBusy ? "Batch working…" : "Generate all assigned lines"}
                    </button>
                  ) : null}
                </div>
              </div>

              {transcriptError ? (
                <div className="mt-3">
                  <ErrorBanner title="Transcript error" detail={transcriptError} />
                </div>
              ) : null}
              {showTranscriptSpinner && !transcriptError ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-foreground">
                  <Spinner className="h-4 w-4 border-t-canvas" />
                  Loading transcript…
                </div>
              ) : null}
              {transcriptFetchDone && !transcriptError && transcriptSegments.length === 0 ? (
                <p className="mt-3 text-sm text-foreground/80">
                  No transcript segments (silent clip or model returned empty).
                </p>
              ) : null}

              {transcriptFetchDone && transcriptSegments.length > 0 ? (
                <ul
                  ref={lineListRef}
                  className="mt-4 max-h-[min(72vh,880px)] space-y-2.5 overflow-y-auto rounded-xl border-2 border-border bg-surface-sunken/50 p-4"
                >
                  {transcriptSegments.map((row) => {
                    const group = speakerGroups.find((g) => g.speaker_label === row.speaker_label);
                    const label = group?.display_name ?? row.speaker_label ?? "Unknown";
                    const sel = selectedTranscriptSegmentId === row.segment_id;
                    const pick = charPickBySegment[row.segment_id] ?? "";
                    const rowRep = episodeReplacements.find(
                      (r) =>
                        r.segment_id === row.segment_id &&
                        (!pick || r.character_id === pick),
                    );
                    const hasGen = Boolean(rowRep?.audio_url);
                    const rowLineText = isHindiTranscriptImport
                      ? hindiPrimaryDisplayText(row, hindiTranscriptViewMode)
                      : row.text;
                    return (
                      <li
                        key={row.segment_id}
                        id={`seg-${row.segment_id}`}
                        className={`rounded-xl border-2 text-left transition ${
                          sel
                            ? "border-primary bg-primary/20 shadow-md ring-2 ring-primary/60"
                            : "border-transparent bg-card hover:border-primary/35 hover:bg-card"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex w-full gap-3 px-4 py-4 text-left"
                          onClick={() => setSelectedTranscriptSegmentId(row.segment_id)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                                {formatTimecode(row.start_time)}
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
                              {hasGen ? (
                                <span className="rounded-full bg-emerald-500/25 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-900 dark:text-emerald-100">
                                  Audio
                                </span>
                              ) : null}
                            </div>
                            <p
                              className={`mt-2 text-lg font-medium leading-relaxed text-foreground ${
                                isHindiTranscriptImport &&
                                hindiTranscriptViewMode === "devanagari"
                                  ? "font-sans"
                                  : ""
                              }`}
                              lang={
                                isHindiTranscriptImport &&
                                hindiTranscriptViewMode === "devanagari"
                                  ? "hi"
                                  : undefined
                              }
                            >
                              {rowLineText}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </Panel>
          </section>

          {/* RIGHT: line inspector (~360–420px; not sticky — avoids overlapping asset strip) */}
          <aside className="flex w-full min-w-0 shrink-0 flex-col space-y-4 xl:w-[26rem] xl:min-w-[22rem] xl:max-w-[28rem]">
            {selectedSeg && transcriptEpisodeId ? (
              <Panel className="rounded-2xl border-2 border-primary/40 bg-primary/[0.08] p-5 shadow-soft ring-1 ring-primary/30">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                      Selected line
                    </p>
                    <p className="mt-1 font-mono text-base font-bold text-foreground">
                      {formatTimecode(selectedSeg.start_time)}
                      <span className="text-muted-foreground"> → </span>
                      {formatTimecode(selectedSeg.end_time)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-card px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {isHindiTranscriptImport
                      ? hindiTranscriptViewMode === "devanagari"
                        ? "Saved on server (Hindi script — main view)"
                        : "Saved on server (Roman Hindi — helper view)"
                      : "Saved on server (read-only snapshot)"}
                  </p>
                  <p
                    className="mt-2 text-base font-medium leading-relaxed text-foreground"
                    lang={
                      isHindiTranscriptImport &&
                      hindiTranscriptViewMode === "devanagari"
                        ? "hi"
                        : undefined
                    }
                  >
                    {isHindiTranscriptImport
                      ? hindiPrimaryDisplayText(selectedSeg, hindiTranscriptViewMode)
                      : selectedSeg.text}
                  </p>
                  {isHindiTranscriptImport ? (
                    <>
                      {hindiTranscriptViewMode === "roman" &&
                      selectedSeg.text_original?.trim() &&
                      selectedSeg.text_original.trim() !== selectedSeg.text.trim() ? (
                        <p className="mt-3 border-t border-border pt-2 text-sm leading-relaxed text-foreground/80">
                          <span className="font-semibold text-foreground">Hindi script (same line):</span>{" "}
                          <span className="font-sans" lang="hi">
                            {selectedSeg.text_original}
                          </span>
                        </p>
                      ) : null}
                      {hindiTranscriptViewMode === "devanagari" &&
                      selectedSeg.text_original?.trim() &&
                      selectedSeg.text.trim() !== selectedSeg.text_original.trim() ? (
                        <p className="mt-3 border-t border-border pt-2 text-sm leading-relaxed text-foreground/80">
                          <span className="font-semibold text-foreground">
                            Roman Hindi (helper, same line):
                          </span>{" "}
                          {selectedSeg.text}
                        </p>
                      ) : null}
                    </>
                  ) : selectedSeg.text_original &&
                    selectedSeg.text_original.trim() !== selectedSeg.text.trim() ? (
                    <p className="mt-3 border-t border-border pt-2 text-sm italic text-foreground/75">
                      ASR original: {selectedSeg.text_original}
                    </p>
                  ) : null}
                </div>

                <label className="mt-4 block text-sm font-semibold text-foreground">
                  Editable text
                  <textarea
                    rows={5}
                    value={lineEditorDraft}
                    onChange={(e) => setLineEditorDraft(e.target.value)}
                    lang={isHindiTranscriptImport ? "hi" : undefined}
                    dir={
                      isHindiTranscriptImport &&
                      hindiTranscriptViewMode === "devanagari"
                        ? "auto"
                        : "ltr"
                    }
                    className={`mt-2 w-full rounded-xl border-2 border-border bg-card px-3 py-3 text-lg leading-relaxed text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 ${
                      isHindiTranscriptImport &&
                      hindiTranscriptViewMode === "devanagari"
                        ? "font-sans"
                        : ""
                    }`}
                  />
                </label>
                {isHindiTranscriptImport ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Save text only sends your edit to the server. Hindi lines are normalized like on
                    import so Roman and Devanagari stay two views of one line: Devanagari is preserved
                    when you type Hindi script; Roman stays in sync for exports and TTS. English imports
                    are unchanged.
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-end gap-4">
                  <label className="block min-w-[12rem] flex-1 text-sm font-semibold text-foreground">
                    Character
                    <select
                      className="mt-1.5 w-full rounded-lg border-2 border-border bg-card px-3 py-2.5 text-base text-foreground outline-none focus:border-primary"
                      value={charPickBySegment[selectedSeg.segment_id] ?? ""}
                      onChange={(e) =>
                        setCharPickBySegment((prev) => ({
                          ...prev,
                          [selectedSeg.segment_id]: e.target.value,
                        }))
                      }
                    >
                      <option value="">None (transcript only)</option>
                      {projectRoster.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.default_voice_id ? "" : " — no voice yet"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-[10rem] flex-1 text-sm font-semibold text-foreground">
                    Tone / style (optional)
                    <input
                      className="mt-1.5 w-full rounded-lg border-2 border-border bg-card px-3 py-2.5 text-base text-foreground outline-none focus:border-primary"
                      value={lineEditorTone}
                      onChange={(e) => setLineEditorTone(e.target.value)}
                      placeholder="e.g. warm, dry, urgent"
                    />
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11 px-5 text-base font-semibold"
                    disabled={saveTextBusy}
                    onClick={() => void saveLineTextOnly()}
                  >
                    {saveTextBusy ? "Saving…" : "Save text only"}
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11 px-5 text-base font-semibold"
                    disabled={
                      batchLineBusy ||
                      generatingSegmentId != null ||
                      !canGenerateSelectedLine
                    }
                    onClick={() =>
                      void generateLineFromTranscript(
                        selectedSeg.segment_id,
                        (lineEditorDraft.trim() || selectedSeg.text).trim(),
                      )
                    }
                  >
                    {generatingSegmentId === selectedSeg.segment_id
                      ? lineEditorReplacement?.audio_url
                        ? "Regenerating…"
                        : "Generating…"
                      : lineEditorReplacement?.audio_url
                        ? "Regenerate audio"
                        : "Generate audio"}
                  </Button>
                </div>

                {!canGenerateSelectedLine && transcriptSegments.length > 0 ? (
                  <p className="mt-4 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm font-medium text-foreground">
                    Create a character and attach a voice to generate audio. Transcript editing and
                    source playback work without a voice.
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Playback
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    className="inline-flex min-h-11 items-center gap-2 px-4 text-base font-semibold"
                    onClick={() => playSourceSegment(transcriptEpisodeId, selectedSeg.segment_id)}
                  >
                    {playingSourceSegId === selectedSeg.segment_id ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="h-5 w-5" />
                    )}
                    Source
                  </Button>
                  {lineEditorReplacement?.audio_url ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="inline-flex min-h-11 items-center gap-2 px-4 text-base font-semibold"
                      onClick={() => playGeneratedSegment(selectedSeg.segment_id)}
                    >
                      {playingGeneratedSegId === selectedSeg.segment_id ? (
                        <Pause className="h-5 w-5" />
                      ) : (
                        <Play className="h-5 w-5" />
                      )}
                      Generated
                    </Button>
                  ) : (
                    <span className="text-sm text-foreground/70">
                      Generated play appears after line audio exists.
                    </span>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-5">
                  <button
                    type="button"
                    className="text-base font-semibold text-red-600 hover:underline dark:text-red-400"
                    onClick={() => void handleDeleteSegment(selectedSeg.segment_id)}
                  >
                    Delete line
                  </button>
                  <Link
                    href={`/replace-lines?episode=${encodeURIComponent(transcriptEpisodeId)}&segment=${encodeURIComponent(selectedSeg.segment_id)}`}
                    className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Open in Replace Lines (advanced)
                  </Link>
                </div>
              </Panel>
            ) : (
              <Panel className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center shadow-soft">
                <p className="text-base font-medium text-foreground">No line selected</p>
                <p className="mt-2 text-sm leading-relaxed text-foreground/75">
                  Select a row in the transcript to edit text, save without generating, and play
                  source audio.
                </p>
              </Panel>
            )}

            {transcriptEpisodeId && transcriptSegments.length > 0 ? (
              <div className="rounded-xl border border-border bg-surface-sunken/60 px-4 py-3">
                <p className="text-sm leading-relaxed text-foreground/80">
                  <span className="font-semibold text-foreground">Replace Lines</span> is for bulk
                  work and history.{" "}
                  <Link
                    href={`/replace-lines?episode=${encodeURIComponent(transcriptEpisodeId)}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    Open Replace Lines
                  </Link>
                </p>
              </div>
            ) : null}
          </aside>
          </div>

          {/* Bottom asset strip: full width below the 3-column row (no grid/sticky overlap) */}
          <div className="w-full min-w-0 space-y-6 border-t border-border pt-8">
            {mediaDone && mediaDone.thumbnail_paths.length > 0 ? (
              <Panel className="rounded-2xl border-2 border-border bg-card p-5 shadow-soft">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                      <Film className="h-5 w-5 text-primary" />
                      Frames from this import
                    </h2>
                    <p className="mt-1 text-sm text-foreground/80">
                      Stills from the active episode. Scroll horizontally on small screens. Assign a
                      frame as a character photo below.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
                  {mediaDone.thumbnail_paths.map((rel, i) => (
                    <div
                      key={rel}
                      className="w-44 shrink-0 snap-start overflow-hidden rounded-xl ring-2 ring-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mediaUrl(rel)}
                        alt={`Frame ${i + 1}`}
                        className="h-32 w-full object-cover"
                      />
                      <div className="flex flex-col gap-1.5 border-t border-border bg-card px-2 py-2">
                        <a
                          href={mediaUrl(rel)}
                          download={`castweave-frame-${i + 1}.jpg`}
                          className="text-sm font-semibold text-primary hover:underline"
                        >
                          Download
                        </a>
                        {transcriptEpisodeId && projectRoster.length > 0 ? (
                          <select
                            className="w-full rounded-md border border-border bg-surface px-1 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
                            defaultValue=""
                            disabled={avatarBusyIndex === i}
                            onChange={(e) => {
                              const cid = e.target.value;
                              if (!cid || !transcriptEpisodeId) return;
                              if (avatarBusyIndex !== null) {
                                e.target.value = "";
                                return;
                              }
                              const selectEl = e.target;
                              setAvatarBusyIndex(i);
                              void (async () => {
                                try {
                                  await api.setCharacterAvatarFromEpisodeThumb(cid, {
                                    episode_id: transcriptEpisodeId,
                                    thumb_index: i,
                                  });
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
                            <option value="">
                              {avatarBusyIndex === i ? "Updating…" : "Use as character photo…"}
                            </option>
                            {projectRoster.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-xs text-foreground/65">Add characters to assign photos.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : mediaDone ? (
              <Panel className="rounded-2xl border border-dashed border-border bg-card/80 p-5 shadow-soft">
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Film className="h-5 w-5 text-muted-foreground" />
                  Frames
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-foreground/80">
                  No frame thumbnails were extracted for this import. Re-import the file if you
                  expected stills here.
                </p>
              </Panel>
            ) : null}

            <Panel className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Layers className="h-5 w-5 text-primary" />
                Saved line audio & clips
              </h2>
              <p className="mt-1 text-sm text-foreground/80">
                Line audio saved for this episode, plus project clip export.
              </p>
              {activeProjectId && projectClipCount > 0 ? (
                <a
                  href={api.projectClipsZipUrl(activeProjectId)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
                >
                  <Package className="h-5 w-5" />
                  Download all clips .zip ({projectClipCount})
                </a>
              ) : (
                <p className="mt-3 text-sm text-foreground/75">
                  No project clip bundle yet. Generate line audio or clips from Voice Studio.
                </p>
              )}
              <ul className="mt-4 divide-y divide-border rounded-xl border-2 border-border">
                {episodeReplacementsForWorkspace.length === 0 ? (
                  <li className="px-4 py-5 text-base text-foreground/75">
                    No saved line audio for this episode yet.
                  </li>
                ) : (
                  episodeReplacementsForWorkspace.map((r) => (
                    <li
                      key={r.replacement_id}
                      className="flex flex-wrap items-start justify-between gap-3 px-4 py-4"
                    >
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-foreground">{r.character_name}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-foreground/80">
                          {r.replacement_text}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {r.audio_url ? (
                          <audio
                            controls
                            className="h-9 max-w-[240px]"
                            src={mediaUrl(r.audio_url.replace(/^\/media\//, ""))}
                          />
                        ) : null}
                        <Link
                          href={`/replace-lines?episode=${encodeURIComponent(r.episode_id)}&segment=${encodeURIComponent(r.segment_id)}`}
                          className="inline-flex items-center rounded-lg border-2 border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:bg-white/[0.06]"
                        >
                          Advanced
                        </Link>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </Panel>
          </div>
        </div>
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
