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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { mediaUrl, mediaUrlWithCacheBust } from "@/lib/api/media";
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
import { DELIVERY_PRESETS } from "@/lib/api/types";
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
  if (!label) return "";
  const voiced = chars.find(
    (c) =>
      Boolean(c.default_voice_id) && c.source_speaker_labels.includes(label),
  );
  if (voiced) return voiced.id;
  const anyLinked = chars.find((c) => c.source_speaker_labels.includes(label));
  return anyLinked?.id ?? "";
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
  const router = useRouter();
  const pathname = usePathname();
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
  /** True while episode replacements are being fetched; avoids list collapse on switch. */
  const [importReplacementsLoading, setImportReplacementsLoading] =
    useState(false);
  const [charPickBySegment, setCharPickBySegment] = useState<
    Record<string, string>
  >({});
  const [lineEditorDraft, setLineEditorDraft] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("neutral");
  const [generatingTakes, setGeneratingTakes] = useState(false);
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
  const transcriptEpisodeIdRef = useRef<string | null>(null);
  /** While router.replace commits, the effect may see an old `?episode=`; avoid syncing back to the previous id. */
  const importUrlExpectEpisodeIdRef = useRef<string | null>(null);
  const importUrlStaleParamEpisodeIdRef = useRef<string | null>(null);
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
  transcriptEpisodeIdRef.current = transcriptEpisodeId;

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
  }, [activeProjectId, phase]);

  useEffect(() => {
    const ep = transcriptEpisodeId;
    if (!ep || phase !== "done") {
      setEpisodeReplacements([]);
      setImportReplacementsLoading(false);
      return;
    }
    let cancelled = false;
    setImportReplacementsLoading(true);
    setEpisodeReplacements([]);
    void api
      .listEpisodeReplacements(ep)
      .then((rows) => {
        if (!cancelled) setEpisodeReplacements(rows);
      })
      .catch(() => {
        if (!cancelled) setEpisodeReplacements([]);
      })
      .finally(() => {
        if (!cancelled) setImportReplacementsLoading(false);
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
    if (
      importUrlExpectEpisodeIdRef.current != null &&
      importUrlStaleParamEpisodeIdRef.current != null &&
      episodeUrlParam === importUrlStaleParamEpisodeIdRef.current &&
      transcriptEpisodeIdRef.current === importUrlExpectEpisodeIdRef.current
    ) {
      return;
    }
    if (
      importUrlExpectEpisodeIdRef.current != null &&
      episodeUrlParam === importUrlExpectEpisodeIdRef.current
    ) {
      importUrlExpectEpisodeIdRef.current = null;
      importUrlStaleParamEpisodeIdRef.current = null;
    }
    if (transcriptEpisodeIdRef.current === episodeUrlParam) {
      return;
    }
    const ep = projectEpisodes.find((e) => e.id === episodeUrlParam);
    if (!ep) return;
    switchToEpisode(ep);
  }, [episodeUrlParam, activeProjectId, phase, projectEpisodes]);

  useEffect(() => {
    if (!selectedTranscriptSegmentId) {
      setLineEditorDraft("");
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
  }, [
    selectedTranscriptSegmentId,
    transcriptSegments,
    isHindiTranscriptImport,
    hindiTranscriptViewMode,
  ]);

  function switchToEpisode(ep: EpisodeDto) {
    if (transcriptEpisodeIdRef.current === ep.id) {
      return;
    }
    if (sourceAudioRef.current) {
      sourceAudioRef.current.pause();
      sourceAudioRef.current = null;
    }
    setPlayingSourceSegId(null);
    if (generatedAudioRef.current) {
      generatedAudioRef.current.pause();
      generatedAudioRef.current = null;
    }
    setPlayingGeneratedSegId(null);
    setCharPickBySegment({});
    setMergeTargetFor({});
    setEditingLabel(null);
    setCharCreateError(null);
    setError(null);
    setConfirmDeleteSegId(null);
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
    transcriptEpisodeIdRef.current = ep.id;
    setPhase("done");
    setJob(null);
    setTranscriptSegments([]);
    setTranscriptFetchDone(false);
    setTranscriptError(null);
    setTranscriptLoading(true);
    setSpeakerGroups([]);
    setSpeakerGroupsError(null);
    setSpeakerGroupsLoading(true);
    setCreatedChars({});
    setSelectedTranscriptSegmentId(null);
    if (searchParams.get("episode") !== ep.id) {
      const prev = searchParams.get("episode");
      importUrlStaleParamEpisodeIdRef.current = prev;
      importUrlExpectEpisodeIdRef.current = ep.id;
      const next = new URLSearchParams(searchParams.toString());
      next.set("episode", ep.id);
      router.replace(`${pathname}?${next.toString()}`);
    } else {
      importUrlExpectEpisodeIdRef.current = null;
      importUrlStaleParamEpisodeIdRef.current = null;
    }
    const finish = () => {
      toast("Switched to imported video");
    };
    if (activeProjectId) {
      void api
        .listEpisodes(activeProjectId)
        .then((rows) => {
          const scored = rows
            .filter((e) => e.segment_count > 0)
            .sort(
              (a, b) =>
                new Date(b.updated_at).getTime() -
                new Date(a.updated_at).getTime(),
            );
          setProjectEpisodes(scored);
          const row = scored.find((e) => e.id === ep.id);
          if (row) {
            setPersistedMedia({
              episode_id: row.id,
              project_id: row.project_id,
              source_video_path: row.source_video_path ?? "",
              extracted_audio_path: row.extracted_audio_path ?? "",
              thumbnail_paths: row.thumbnail_paths ?? [],
              duration_sec: row.duration_sec ?? undefined,
              transcript_segment_count: row.segment_count,
              transcript_language: row.transcript_language ?? undefined,
            });
          }
          finish();
        })
        .catch(() => {
          finish();
        });
    } else {
      finish();
    }
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
    const rel = rep.audio_url.replace(/^\/media\//, "");
    const url = mediaUrlWithCacheBust(rel, rep.updated_at);
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
      setPlayingGeneratedSegId((id) => {
        if (id !== segmentId) return id;
        generatedAudioRef.current?.pause();
        generatedAudioRef.current = null;
        return null;
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
        const lineText = isHindiTranscriptImport
          ? hindiPrimaryDisplayText(row, "devanagari")
          : row.text;
        const ok = await generateLineFromTranscript(row.segment_id, lineText, {
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
        const lineText = isHindiTranscriptImport
          ? hindiPrimaryDisplayText(row, "devanagari")
          : row.text;
        const ok = await generateLineFromTranscript(row.segment_id, lineText, {
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
      const pid = c.project_id || activeProjectId;
      if (pid) {
        try {
          const rows = await api.listCharacters(pid);
          setProjectRoster(rows);
        } catch {
          setProjectRoster((prev) => {
            if (prev.some((x) => x.id === c.id)) return prev;
            return [...prev, c];
          });
        }
      } else {
        setProjectRoster((prev) => {
          if (prev.some((x) => x.id === c.id)) return prev;
          return [...prev, c];
        });
      }
      setCharPickBySegment((prev) => {
        const next = { ...prev };
        for (const row of transcriptSegments) {
          if ((row.speaker_label || "") !== label) continue;
          if (next[row.segment_id]) continue;
          next[row.segment_id] = c.id;
        }
        return next;
      });
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

  const importBottomAssetsPending = Boolean(
    workspaceReady &&
      transcriptEpisodeId &&
      (transcriptLoading ||
        !transcriptFetchDone ||
        importReplacementsLoading),
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Workspace header ── */}
      <header className="h-[60px] shrink-0 bg-surface border-b border-border flex items-center px-8 gap-5">
        <Link href="/projects" className="size-8 rounded-md hover:bg-canvas flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors -ml-1">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </Link>
        <nav className="flex items-center gap-2 text-[13px] min-w-0">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveProjectId(p.id)}
              className={`px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors ${
                activeProjectId === p.id
                  ? "bg-foreground text-surface shadow-xs"
                  : "text-foreground-muted hover:text-foreground hover:bg-canvas"
              }`}
              disabled={boot}
            >
              {p.name}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[12px] text-foreground-muted num font-medium">
          {mediaDone?.duration_sec != null && <span>{Math.round(mediaDone.duration_sec)}s</span>}
          {mediaDone?.transcript_language && (<><span className="text-border">&middot;</span><span>{spokenLanguageUiLabel(mediaDone.transcript_language)}</span></>)}
        </div>
        <div className="h-5 w-px bg-border" />
        {transcriptEpisodeId && (
          <div className="flex items-center gap-1.5">
            <a href={api.episodeTranscriptExportUrl(transcriptEpisodeId, "srt")} target="_blank" rel="noreferrer" className="h-8 px-2.5 rounded-md text-[12px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas border border-border flex items-center gap-1 transition-colors">
              <Download className="size-3.5" /> .srt
            </a>
            {activeProjectId && projectClipCount > 0 && (
              <a href={api.projectClipsZipUrl(activeProjectId)} target="_blank" rel="noreferrer" className="h-8 px-2.5 rounded-md text-[12px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas border border-border flex items-center gap-1 transition-colors">
                <Package className="size-3.5" /> Clips ({projectClipCount})
              </a>
            )}
          </div>
        )}
      </header>

      {/* ── Pipeline steps strip ── */}
      <div className="h-[68px] shrink-0 bg-surface border-b border-border flex items-stretch px-8">
        {PIPELINE_ICONS.map((Icon, idx) => {
          const label = PIPELINE_STEPS[idx]!;
          const active = pipelineActiveIndex === idx && (phase === "uploading" || phase === "processing");
          const past = pipelineActiveIndex > idx || (phase === "done" && pipelineActiveIndex >= idx);
          const isLast = idx === PIPELINE_STEPS.length - 1;
          return (
            <div key={label} className="flex items-center flex-1 min-w-0">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`size-8 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                  active ? "bg-foreground text-surface border-foreground" :
                  past ? "bg-success text-white border-success" :
                  "bg-canvas text-foreground-subtle border-border"
                }`}>
                  {active ? <Spinner className="h-3.5 w-3.5 border-t-surface" /> : past ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={3} /> : <Icon className="size-[15px]" />}
                </div>
                <div className="min-w-0">
                  <div className={`text-[10.5px] font-bold uppercase tracking-[0.14em] ${active ? "text-foreground" : past ? "text-success" : "text-foreground-subtle"}`}>Step {idx + 1}</div>
                  <div className={`text-[13px] font-bold tracking-tight leading-tight ${active ? "text-foreground" : past ? "text-success" : "text-foreground-subtle"}`}>{label}</div>
                </div>
              </div>
              {!isLast && <div className="h-px w-8 mx-2 bg-border shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* Episode tabs */}
      {projectEpisodes.length > 0 && workspaceReady && (
        <div className="h-10 shrink-0 bg-canvas border-b border-border flex items-center px-8 gap-1">
          <span className="label-section mr-3">Episodes</span>
          {projectEpisodes.map((ep) => {
            const active = transcriptEpisodeId === ep.id;
            return (
              <button key={ep.id} type="button" onClick={() => { if (!active) switchToEpisode(ep); }}
                className={`h-7 px-3 rounded-md flex items-center gap-2 text-[12.5px] font-medium transition-colors ${active ? "bg-surface border border-border shadow-xs text-foreground" : "text-foreground-muted hover:text-foreground hover:bg-surface/60"}`}>
                {ep.media_type === "audio" ? <Mic2 className="size-3" /> : <FileVideo className="size-3" />}
                <span className="max-w-[10rem] truncate">{episodeImportLabel(ep)}</span>
                <span className="text-[10.5px] num text-foreground-subtle">{ep.segment_count}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="mx-8 mt-3"><ErrorBanner title="Request error" detail={error} /></div>}

      {isReImporting && (
        <div className="mx-8 mt-3 px-4 py-3 bg-warning-soft border border-warning-border rounded-lg">
          <div className="flex items-center gap-3">
            <Spinner className="h-4 w-4 border-t-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-warning-foreground">
                {phase === "uploading" ? "Uploading new video..." : job?.message || `${PIPELINE_STEPS[pipelineActiveIndex] ?? "Processing"}...`}
              </p>
              <p className="text-[11px] text-warning-foreground/70">A new import is being processed. The current workspace stays available below.</p>
            </div>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-warning-border">
            {phase === "uploading" ? (
              <div className="h-full rounded-full bg-warning transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0, uploadRatio)) * 100)}%` }} />
            ) : typeof job?.progress === "number" ? (
              <div className="h-full rounded-full bg-warning transition-[width] duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%` }} />
            ) : (
              <div className="relative h-full w-full"><div className="motion-safe:animate-pulse absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-warning/25 via-warning/80 to-warning/25 [animation-duration:1.3s]" /></div>
            )}
          </div>
        </div>
      )}

      {importBootKind === "restored" && workspaceReady && (
        <div className="mx-8 mt-2 px-4 py-2.5 bg-accent-soft border border-accent/20 rounded-lg text-[13px] text-foreground">
          Loaded your saved import for this project. Upload again to start a new run.
        </div>
      )}

      {workspaceReady && mediaDone?.transcript_coverage_low && transcriptEpisodeId && coverageBannerDismissedFor !== transcriptEpisodeId && (
        <div className="mx-8 mt-2 px-4 py-3 bg-warning-soft border border-warning-border rounded-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-warning-foreground">Transcript coverage looks low for this import</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-warning-foreground/70">
                {typeof mediaDone.transcript_coverage_ratio === "number" ? `Only about ${Math.round(mediaDone.transcript_coverage_ratio * 100)}% of the audio produced transcript lines. ` : ""}
                You can edit lines inline, or re-upload a cleaner version of the file for better results.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => { setPersistedMedia(null); setPhase("idle"); setImportBootKind("none"); setCoverageBannerDismissedFor(transcriptEpisodeId); }} className="h-8 px-3 rounded-md text-[11px] font-semibold text-foreground border border-border hover:border-border-strong transition-colors">Try another upload</button>
              <button type="button" onClick={() => setCoverageBannerDismissedFor(transcriptEpisodeId)} className="h-8 px-2 rounded-md text-[11px] font-semibold text-foreground-muted hover:text-foreground transition-colors">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Upload area ── */}
      {!workspaceReady ? (
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-10">
          <div className="w-full max-w-2xl">
            <div className="bg-surface border border-border rounded-xl p-8">
              <label
                htmlFor="video-upload"
                className="group flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border-strong p-10 text-center transition-all hover:border-accent hover:bg-accent-soft/20"
              >
                <div className="size-14 rounded-full bg-accent-soft flex items-center justify-center group-hover:scale-110 transition-transform">
                  <UploadCloud className="size-6 text-accent" strokeWidth={2} />
                </div>
                <div className="text-[18px] font-bold tracking-tight text-foreground">
                  {file ? file.name : "Drop a video or audio file, or click to browse"}
                </div>
                <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-foreground-muted">
                  Video (MP4, MOV, MKV, WebM) or audio (MP3, WAV, M4A, FLAC, OGG). Processing runs locally.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono text-foreground-subtle">
                  {["MP4", "MOV", "MKV", "WEBM", "MP3", "WAV", "M4A", "FLAC"].map((f) => (
                    <span key={f} className="rounded-md border border-border bg-canvas px-1.5 py-0.5 uppercase tracking-wider">{f}</span>
                  ))}
                </div>
                <input id="video-upload" ref={inputRef} type="file" className="hidden" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/flac,audio/ogg,audio/aac,.mp4,.mov,.mkv,.webm,.m4v,.avi,.mp3,.wav,.m4a,.flac,.ogg,.aac,.wma" onChange={(e) => { const fnext = e.target.files?.[0] ?? null; setFile(fnext); setImportBootKind("none"); setPhase("idle"); setJob(null); setPersistedMedia(null); setError(null); setTranscriptSegments([]); setTranscriptError(null); setTranscriptFetchDone(false); setSpeakerGroups([]); setSpeakerGroupsError(null); setSelectedTranscriptSegmentId(null); if (storageKey) { try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ } } }} />
              </label>
              <div className="mt-5 flex items-center justify-between gap-4">
                <div className="text-[12.5px] text-foreground-muted">{file ? (<><span className="font-semibold text-foreground">Selected:</span> {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)</>) : "No file selected"}</div>
                <button type="button" disabled={busy || !activeProjectId || !file} onClick={() => void startUpload()} className="h-10 px-5 rounded-md text-[13.5px] font-bold bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-2 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {busy ? (<><Spinner className="h-4 w-4 border-t-white" />{phase === "uploading" ? "Uploading..." : "Processing..."}</>) : (<><Wand2 className="h-4 w-4" />Upload and process</>)}
                </button>
              </div>
              {(phase === "uploading" || phase === "processing") && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="size-9 rounded-full bg-accent-soft flex items-center justify-center shrink-0"><Spinner className="h-4 w-4 border-t-accent" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground">{phase === "uploading" ? "Uploading your video..." : job?.message || `${PIPELINE_STEPS[pipelineActiveIndex] ?? "Working on your import"}...`}</p>
                      <p className="mt-0.5 text-[11.5px] text-foreground-muted">Keep this tab open. Processing time depends on media length.</p>
                      {phase === "processing" && processingTrust.severeStall && <p className="mt-1 text-[11px] text-warning-foreground">No server updates for several minutes. Check API logs or try again.</p>}
                    </div>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                    {phase === "uploading" ? (<div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0, uploadRatio)) * 100)}%` }} />) : processingTrust.determinate && typeof job?.progress === "number" ? (<div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%` }} />) : (<div className="relative h-full w-full"><div className="motion-safe:animate-pulse absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-accent/25 via-accent/80 to-accent/25 [animation-duration:1.3s]" /></div>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── MAIN IMPORT EDITOR (workspace + cast + transcript) ── */}
      {workspaceReady ? (
        <>
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* ─── LEFT: Cast (320px) ─── */}
          <aside className="w-[320px] shrink-0 bg-canvas border-r border-border flex flex-col min-h-0">
            <div className="h-12 shrink-0 px-5 flex items-center justify-between border-b border-border">
              <div className="flex items-baseline gap-2">
                <h2 className="label-section">Cast</h2>
                <span className="text-[11px] text-foreground-subtle num font-semibold">{visibleCastGroups.length} speaker{visibleCastGroups.length === 1 ? "" : "s"}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {/* Re-upload inside cast panel */}
              <details className="group mb-3 rounded-lg border border-border bg-surface p-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  <UploadCloud className="size-3.5 text-accent" />
                  Upload new media
                  <ChevronDown className="ml-auto size-3 shrink-0 text-foreground-subtle transition group-open:rotate-180" />
                </summary>
                <div className="mt-2">
                  <label htmlFor="video-upload-re" className="group flex cursor-pointer flex-col items-center gap-1.5 rounded-md border-2 border-dashed border-border-strong p-3 text-center hover:border-accent hover:bg-accent-soft/20">
                    <span className="text-[12px] font-medium text-foreground">{file ? file.name : "Choose file"}</span>
                    <input id="video-upload-re" type="file" className="hidden" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/flac,audio/ogg,audio/aac,.mp4,.mov,.mkv,.webm,.m4v,.avi,.mp3,.wav,.m4a,.flac,.ogg,.aac,.wma" onChange={(e) => { const fnext = e.target.files?.[0] ?? null; setFile(fnext); }} />
                  </label>
                  <button type="button" disabled={busy || isReImporting || !activeProjectId || !file} onClick={() => void startUpload()} className="mt-2 w-full h-8 rounded-md bg-accent text-white text-[12px] font-bold disabled:opacity-40">
                    {busy || isReImporting ? "Import in progress..." : "Upload and process"}
                  </button>
                </div>
              </details>
              {speakerGroupsError && <div className="mb-2"><ErrorBanner title="Cast detection" detail={speakerGroupsError} /></div>}
              {charCreateError && <div className="mb-2"><ErrorBanner title="Character creation" detail={charCreateError} /></div>}

              {speakerGroupsLoading && <div className="flex items-center gap-2 text-[12px] text-foreground-muted p-3"><Spinner className="h-3.5 w-3.5 border-t-accent" />Resolving detected cast...</div>}
              {!speakerGroupsLoading && speakerGroups.length === 0 && <p className="text-[12px] text-foreground-muted p-3">No separate voices detected. Try a clip with clearer speaker turns, or add characters manually.</p>}

              {!speakerGroupsLoading && visibleCastGroups.length > 0 ? (
                <ul className="space-y-2">
                  {visibleCastGroups.map((g) => {
                    const created = createdChars[g.speaker_label];
                    const others = visibleCastGroups.filter((x) => x.speaker_label !== g.speaker_label).map((x) => x.speaker_label);
                    const mergePick = mergeTargetFor[g.speaker_label] ?? others[0] ?? "";
                    return (
                      <li key={g.speaker_label} id={speakerRowDomId(g.speaker_label)} className="scroll-mt-24 rounded-lg bg-surface border border-border p-3">
                        <div className="flex items-start gap-2">
                          <Mic2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            {editingLabel === g.speaker_label ? (
                              <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void handleRename(g.speaker_label, editValue); }}>
                                <input className="min-w-[8rem] flex-1 rounded-md border border-border bg-canvas px-2 py-1 text-[13px] text-foreground outline-none focus:border-border-strong" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
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
                            <p className="mt-0.5 text-[11px] text-foreground-subtle num">{g.segment_count} segments &middot; {g.total_speaking_duration.toFixed(1)}s</p>
                          </div>
                        </div>

                        {created ? (
                          <div className="mt-2.5 space-y-2">
                            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-success">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Character created
                              {created.voice_display_name ? (
                                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                  Voice: {created.voice_display_name}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {!created.default_voice_id ? (
                                <Link href={`/voice-studio?character=${encodeURIComponent(created.id)}&panel=voice&focus=attach`} className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-bold text-white shadow-xs transition hover:bg-accent-hover">
                                  <Volume2 className="h-3 w-3" />Attach voice
                                </Link>
                              ) : (
                                <Link href={`/voice-studio?character=${encodeURIComponent(created.id)}&panel=voice`} className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-semibold text-foreground transition hover:border-border-strong">
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
                            <input className="min-w-[8rem] flex-1 rounded-md border border-border bg-canvas px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-border-strong" placeholder="Character name" value={charNameInput} onChange={(e) => setCharNameInput(e.target.value)} autoFocus />
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
                          <details className="group mt-2 border-t border-border pt-2">
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
                                    <select className="rounded-md border border-border bg-canvas px-1.5 py-1 text-[11px] text-foreground outline-none" value={mergePick} onChange={(e) => setMergeTargetFor((m) => ({ ...m, [g.speaker_label]: e.target.value }))}>
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

              {ignoredLabels.size > 0 && (
                <details className="mt-3 rounded-lg bg-surface border border-border p-2">
                  <summary className="cursor-pointer list-none text-[12px] font-semibold text-foreground-muted hover:text-foreground [&::-webkit-details-marker]:hidden">Skipped ({ignoredLabels.size})</summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">{[...ignoredLabels].map((lab) => (<button key={lab} type="button" className="rounded-md bg-canvas px-2.5 py-0.5 text-[11px] font-medium text-foreground border border-border hover:border-border-strong" onClick={() => toggleIgnore(lab)}>Restore {lab}</button>))}</div>
                </details>
              )}
            </div>
          </aside>

          {/* CENTER: transcript (flex-1) */}
          <section className="flex-1 flex flex-col min-w-0 min-h-0 bg-surface border-l border-r border-border">
            {/* Transcript toolbar */}
            <div className="h-12 shrink-0 border-b border-border flex items-center px-7 gap-3">
              <h2 className="label-section mr-2">Transcript</h2>
              {isHindiTranscriptImport && (
                <div className="flex items-center gap-1">
                  {(["devanagari", "roman"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => {
                      setHindiTranscriptViewMode(m);
                      if (transcriptEpisodeId) { try { window.localStorage.setItem(storageKeyForHindiTranscriptView(transcriptEpisodeId), m); } catch { /* ignore */ } }
                      if (selectedTranscriptSegmentId) { const row = transcriptSegments.find((s) => s.segment_id === selectedTranscriptSegmentId); if (row) setLineEditorDraft(hindiPrimaryDisplayText(row, m)); }
                    }} className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${hindiTranscriptViewMode === m ? "bg-foreground text-surface shadow-xs" : "text-foreground-muted hover:text-foreground hover:bg-canvas"}`}>
                      {m === "devanagari" ? "Hindi" : "Roman"}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1" />
              {showTranscriptSpinner && <span className="text-[11.5px] text-foreground-muted font-semibold">Loading...</span>}
              <div className="flex items-center gap-3 text-[11.5px] text-foreground-subtle num font-medium">
                {transcriptFetchDone && <span className="text-success">{episodeReplacementsForWorkspace.filter(r => r.generated_audio_path).length} generated</span>}
                {transcriptFetchDone && <span className="text-accent">{transcriptSegments.filter(s => { const cid = charPickBySegment[s.segment_id]; return cid && projectRoster.find(c => c.id === cid)?.default_voice_id; }).length} ready</span>}
              </div>
              {anyCharacterHasVoice && transcriptFetchDone && !transcriptError && transcriptSegments.length > 0 && (
                <button type="button" className="h-8 px-3.5 rounded-md text-[12.5px] font-bold bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-40" disabled={batchLineBusy || generatingSegmentId != null} onClick={() => void generateAllAssignedTranscriptLines()}>
                  <Wand2 className="size-3.5" />{batchLineBusy ? "Working..." : "Generate all"}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-10 py-8">
              {transcriptError && <div className="mb-3"><ErrorBanner title="Transcript error" detail={transcriptError} /></div>}
              {showTranscriptSpinner && !transcriptError && (
                <div className="flex items-center justify-center h-full gap-2 text-[13px] text-foreground-muted"><Spinner className="h-4 w-4 border-t-accent" />Loading transcript...</div>
              )}
              {transcriptFetchDone && !transcriptError && transcriptSegments.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-foreground-muted gap-2 py-16">
                  <FileText className="size-6 text-border-strong" />
                  <div className="text-[13px] font-semibold">No transcript lines</div>
                  <div className="text-[12px] text-foreground-subtle max-w-xs">Silent clip or the transcription model returned empty.</div>
                </div>
              )}

              {transcriptFetchDone && transcriptSegments.length > 0 ? (
                <ul ref={lineListRef} className="max-w-[920px] mx-auto flex flex-col">
                  {transcriptSegments.map((row) => {
                    const group = speakerGroups.find((g) => g.speaker_label === row.speaker_label);
                    const label = group?.display_name ?? row.speaker_label ?? "Unknown";
                    const sel = selectedTranscriptSegmentId === row.segment_id;
                    const pick = charPickBySegment[row.segment_id] ?? "";
                    const rowRep = episodeReplacementsForWorkspace.find(
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
                        className={`group relative transition-all ${
                          sel
                            ? "bg-canvas/80 -mx-3 px-3 rounded-xl ring-1 ring-foreground/10 my-1"
                            : "border-b border-border-subtle hover:bg-canvas/50 -mx-3 px-3"
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full grid grid-cols-[48px_72px_1fr] items-start gap-5 py-5 text-left cursor-pointer"
                          onClick={() => setSelectedTranscriptSegmentId(row.segment_id)}
                        >
                          <span className="text-[11px] num font-bold text-foreground-subtle text-right pt-1">
                            {String(transcriptSegments.indexOf(row) + 1).padStart(3, "0")}
                          </span>
                          <div className="flex flex-col items-start gap-2 pt-0.5">
                            <span className={`text-[11px] font-bold num ${sel ? "text-foreground" : "text-foreground-subtle"}`}>{formatTimecode(row.start_time)}</span>
                            {transcriptEpisodeId && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); playSourceSegment(transcriptEpisodeId, row.segment_id); }} className={`size-7 rounded-full bg-surface border border-border flex items-center justify-center hover:border-foreground-muted transition-all ${sel ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                                {playingSourceSegId === row.segment_id ? <Pause className="size-3 text-foreground" /> : <Play className="size-3 fill-foreground text-foreground ml-0.5" />}
                              </button>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5 mb-2">
                              <span className="text-[12px] font-bold tracking-tight">{label}</span>
                              {hasGen && <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-success"><CheckCircle2 className="size-3" />Generated</span>}
                              {!hasGen && pick && projectRoster.find(c => c.id === pick)?.default_voice_id && (
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-accent"><Wand2 className="size-3" />Ready</span>
                              )}
                            </div>
                            <p className={`leading-[1.7] text-pretty max-w-[68ch] ${sel ? "text-[16.5px] text-foreground font-medium" : "text-[15px] text-foreground/85"} ${isHindiTranscriptImport && hindiTranscriptViewMode === "devanagari" ? "font-sans" : ""}`} lang={isHindiTranscriptImport && hindiTranscriptViewMode === "devanagari" ? "hi" : undefined}>
                              {rowLineText}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </section>

          {/* RIGHT: line inspector (400px) */}
          <aside className="w-[400px] shrink-0 bg-canvas flex flex-col min-h-0">
            {selectedSeg && transcriptEpisodeId ? (
              <><div className="h-12 shrink-0 px-6 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-2.5">
                  <h2 className="label-section">Selected line</h2>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border bg-canvas text-foreground-muted">
                    Line {transcriptSegments.indexOf(selectedSeg) + 1}
                  </span>
                </div>
                <span className="text-[10.5px] num text-foreground-subtle font-semibold">{formatTimecode(selectedSeg.start_time)}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6">
                {/* Source playback */}
                <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3 shadow-xs">
                  <button type="button" onClick={() => playSourceSegment(transcriptEpisodeId, selectedSeg.segment_id)} className="size-11 rounded-full bg-foreground text-surface flex items-center justify-center hover:bg-foreground/90 transition-colors shrink-0 shadow-sm">
                    {playingSourceSegId === selectedSeg.segment_id ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current ml-0.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                      Original source
                    </div>
                    <div className="text-[11px] text-foreground-subtle num mt-0.5">{formatTimecode(selectedSeg.start_time)}</div>
                  </div>
                  <div className="flex items-end gap-[2px] h-8">
                    {[3,7,4,8,12,9,14,11,6,9,5,10,7].map((h, i) => (
                      <span key={i} className="w-[2.5px] rounded-full bg-foreground/35" style={{ height: `${h * 2}px` }} />
                    ))}
                  </div>
                </div>
                <section>
                  <div className="bg-surface border border-border rounded-lg px-4 py-3">
                    <p className="text-[13px] leading-relaxed text-foreground" lang={isHindiTranscriptImport && hindiTranscriptViewMode === "devanagari" ? "hi" : undefined}>
                      {isHindiTranscriptImport ? hindiPrimaryDisplayText(selectedSeg, hindiTranscriptViewMode) : selectedSeg.text}
                    </p>
                    {isHindiTranscriptImport && hindiTranscriptViewMode === "roman" && selectedSeg.text_original?.trim() && selectedSeg.text_original.trim() !== selectedSeg.text.trim() && (
                      <p className="mt-2 pt-2 border-t border-border text-[12px] text-foreground-muted"><span className="font-semibold text-foreground">Hindi script:</span> <span className="font-sans" lang="hi">{selectedSeg.text_original}</span></p>
                    )}
                    {isHindiTranscriptImport && hindiTranscriptViewMode === "devanagari" && selectedSeg.text_original?.trim() && selectedSeg.text.trim() !== selectedSeg.text_original.trim() && (
                      <p className="mt-2 pt-2 border-t border-border text-[12px] text-foreground-muted"><span className="font-semibold text-foreground">Roman Hindi:</span> {selectedSeg.text}</p>
                    )}
                    {!isHindiTranscriptImport && selectedSeg.text_original && selectedSeg.text_original.trim() !== selectedSeg.text.trim() && (
                      <p className="mt-2 pt-2 border-t border-border text-[12px] text-foreground-subtle italic">ASR original: {selectedSeg.text_original}</p>
                    )}
                  </div>
                </section>

                {/* Editable text */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <label className="label-section">Line text</label>
                    <button type="button" disabled={saveTextBusy} onClick={() => void saveLineTextOnly()} className="text-[11px] font-semibold text-foreground-muted hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-50">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                      {saveTextBusy ? "Saving..." : "Save text"}
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    value={lineEditorDraft}
                    onChange={(e) => setLineEditorDraft(e.target.value)}
                    lang={isHindiTranscriptImport ? "hi" : undefined}
                    dir={isHindiTranscriptImport && hindiTranscriptViewMode === "devanagari" ? "auto" : "ltr"}
                    className={`bg-surface border border-border rounded-lg p-4 text-[14.5px] leading-relaxed text-foreground resize-none ring-focus transition-shadow ${isHindiTranscriptImport && hindiTranscriptViewMode === "devanagari" ? "font-sans" : ""}`}
                    spellCheck={false}
                  />
                  <div className="flex items-center justify-between text-[11px] text-foreground-subtle num">
                    <span>{lineEditorDraft.length} chars</span>
                  </div>
                </div>

                {/* Character & voice */}
                <div className="flex flex-col gap-2.5">
                  <label className="label-section">Character & voice</label>
                  <select
                    className="w-full h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-foreground outline-none focus:border-border-strong"
                    value={charPickBySegment[selectedSeg.segment_id] ?? ""}
                    onChange={(e) => setCharPickBySegment((prev) => ({ ...prev, [selectedSeg.segment_id]: e.target.value }))}
                  >
                    <option value="">None (transcript only)</option>
                    {projectRoster.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.default_voice_id ? "" : " -- no voice yet"}</option>
                    ))}
                  </select>
                </div>

                {/* Delivery preset */}
                {canGenerateSelectedLine && (
                  <div className="flex flex-col gap-2.5">
                    <label className="label-section">Delivery</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {DELIVERY_PRESETS.map((p) => (
                        <button key={p} type="button" onClick={() => setSelectedPreset(p)} className={`h-9 rounded-md text-[12.5px] font-semibold transition-colors ${selectedPreset === p ? "bg-foreground text-surface" : "bg-surface border border-border text-foreground-muted hover:text-foreground hover:border-border-strong"}`}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Generated audio */}
                {lineEditorReplacement?.audio_url && (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <label className="label-section text-success">Generated audio</label>
                      <span className="text-[10.5px] font-bold text-success uppercase tracking-wider">Saved</span>
                    </div>
                    <div className="rounded-lg bg-success-soft/70 border border-success/30 p-4 flex items-center gap-3">
                      <button type="button" onClick={() => playGeneratedSegment(selectedSeg.segment_id)} className="size-10 rounded-full bg-success text-white flex items-center justify-center shrink-0 shadow-xs">
                        {playingGeneratedSegId === selectedSeg.segment_id ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current ml-0.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-bold text-foreground truncate">Generated clip</div>
                        <div className="text-[11px] text-foreground-subtle num">Active take</div>
                      </div>
                      {lineEditorReplacement.audio_url && (
                        <a href={mediaUrl(lineEditorReplacement.audio_url.replace(/^\/media\//, ""))} download className="size-8 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface flex items-center justify-center" title="Download">
                          <Download className="size-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Take strip */}
                {(() => {
                  const allReps = episodeReplacementsForWorkspace.filter((r) => r.segment_id === selectedSeg.segment_id);
                  if (allReps.length <= 1) return null;
                  return (
                    <section>
                      <span className="label-eyebrow mb-2 block">Takes</span>
                      <div className="flex flex-wrap gap-1.5">
                        {allReps.map((rep) => {
                          const isActive = rep.is_active_take === 1;
                          return (
                            <div key={rep.replacement_id} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-semibold transition ${isActive ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-foreground hover:border-border-strong"}`}>
                              <span>Take {rep.take_number ?? "?"}</span>
                              {rep.delivery_preset && rep.delivery_preset !== "neutral" && (
                                <span className="rounded bg-canvas px-1 py-0.5 text-[10px] text-foreground-subtle capitalize">{rep.delivery_preset}</span>
                              )}
                              {rep.audio_url && (
                                <button type="button" className="rounded p-0.5 hover:text-accent" onClick={() => { const url = mediaUrl(rep.audio_url.replace(/^\/media\//, "")); const audio = new Audio(url); audio.play().catch(() => {}); }}>
                                  <Play className="h-3 w-3" />
                                </button>
                              )}
                              {!isActive && (
                                <button type="button" className="rounded px-1.5 py-0.5 text-[10px] font-bold text-accent hover:bg-accent-soft" onClick={async () => {
                                  try { await api.setActiveTake(transcriptEpisodeId, rep.replacement_id); setEpisodeReplacements((prev) => prev.map((r: ReplacementDto) => { if (r.segment_id !== rep.segment_id || r.character_id !== rep.character_id) return r; return { ...r, is_active_take: r.replacement_id === rep.replacement_id ? 1 : 0 }; })); toast("Active take updated"); }
                                  catch { toast("Failed to set active take"); }
                                }}>Use</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })()}

                {/* Blocked guidance */}
                {!canGenerateSelectedLine && transcriptSegments.length > 0 && (
                  <div className="rounded-lg bg-warning-soft border border-warning-border p-4 text-[12.5px]">
                    <div className="flex items-center gap-2 text-warning-foreground font-semibold">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      Cannot generate
                    </div>
                    <p className="text-[11.5px] text-warning-foreground/80 mt-1.5 ml-6">
                      {(() => {
                        const segLabel = selectedSeg?.speaker_label ?? "";
                        const assignedChar = projectRoster.find((c: CharacterDto) => c.source_speaker_labels.includes(segLabel)) ?? (charPickBySegment[selectedSeg?.segment_id ?? ""] ? projectRoster.find((c: CharacterDto) => c.id === charPickBySegment[selectedSeg?.segment_id ?? ""]) : null);
                        if (!assignedChar) return "Assign a character to this line to enable generation.";
                        if (!assignedChar.default_voice_id) return `"${assignedChar.name}" has no voice attached. Go to Voice Studio to attach one.`;
                        return "Create a character and attach a voice to generate audio.";
                      })()}
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="shrink-0 p-5 border-t border-border bg-surface/80 backdrop-blur-sm flex flex-col gap-3">
                {!canGenerateSelectedLine ? (
                  <button disabled className="w-full h-11 rounded-md bg-canvas border border-border text-foreground-subtle text-[13.5px] font-bold cursor-not-allowed flex items-center justify-center gap-2">
                    <Wand2 className="size-4" /> Generate audio
                  </button>
                ) : (
                  <button type="button" disabled={batchLineBusy || generatingSegmentId != null || generatingTakes} onClick={() => void generateLineFromTranscript(selectedSeg.segment_id, (lineEditorDraft.trim() || selectedSeg.text).trim())} className="w-full h-11 rounded-md bg-accent text-white hover:bg-accent-hover text-[13.5px] font-bold flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    <Wand2 className="size-4" />
                    {generatingSegmentId === selectedSeg.segment_id ? (lineEditorReplacement?.audio_url ? "Regenerating..." : "Generating...") : (lineEditorReplacement?.audio_url ? "Re-generate audio" : "Generate audio")}
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={saveTextBusy} onClick={() => void saveLineTextOnly()} className="h-9 rounded-md text-[12.5px] font-semibold text-foreground-muted hover:text-foreground bg-surface border border-border hover:border-border-strong transition-colors flex items-center justify-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save text
                </button>
                {transcriptEpisodeId ? (
                  <Link href={`/replace-lines?episode=${encodeURIComponent(transcriptEpisodeId)}&segment=${encodeURIComponent(selectedSeg.segment_id)}`} className="h-9 rounded-md text-[12.5px] font-semibold text-foreground-muted hover:text-foreground bg-surface border border-border hover:border-border-strong transition-colors flex items-center justify-center">
                    Replace lines
                  </Link>
                ) : (
                  <span className="h-9 rounded-md text-[12.5px] font-semibold text-foreground-subtle bg-surface border border-border opacity-50 cursor-not-allowed flex items-center justify-center">
                    Replace lines
                  </span>
                )}
                </div>
                <button type="button" disabled={batchLineBusy || generatingSegmentId != null || generatingTakes || !canGenerateSelectedLine} onClick={async () => {
                  const charId = charPickBySegment[selectedSeg.segment_id] || projectRoster.find((c: CharacterDto) => c.source_speaker_labels.includes(selectedSeg.speaker_label ?? ""))?.id;
                  if (!charId) { toast("Assign a character first"); return; }
                  setGeneratingTakes(true);
                  try {
                    const takes = await api.generateTakes(transcriptEpisodeId, selectedSeg.segment_id, { character_id: charId, replacement_text: (lineEditorDraft.trim() || selectedSeg.text).trim(), delivery_preset: selectedPreset, take_count: 3 });
                    setEpisodeReplacements((prev) => { const existing = prev.filter((r: ReplacementDto) => !takes.some((t: ReplacementDto) => t.replacement_id === r.replacement_id)); return [...existing, ...takes]; });
                    toast(`Generated ${takes.length} takes`);
                  } catch (e) { toast(e instanceof Error ? e.message : "Take generation failed"); }
                  finally { setGeneratingTakes(false); }
                }} className="w-full h-9 rounded-md text-[12.5px] font-semibold bg-surface border border-border text-foreground-muted hover:text-foreground hover:border-border-strong transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
                  {generatingTakes ? "Generating takes..." : "Generate 3 takes"}
                </button>
              </div></>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-foreground-muted gap-3">
                <div className="size-14 rounded-full bg-surface border border-border flex items-center justify-center">
                  <Wand2 className="size-6 text-foreground-subtle" />
                </div>
                <div className="text-[14px] font-semibold">Select a line</div>
                <div className="text-[12px] text-foreground-subtle max-w-[240px]">Click a transcript line on the left to inspect and generate audio for it.</div>
              </div>
            )}
          </aside>

        </div>

        {/* Bottom asset strip */}
        {!importBottomAssetsPending && mediaDone && (
          <section className="shrink-0 bg-surface border-t border-border">
            <div className="px-8 h-11 border-b border-border-subtle flex items-center gap-1">
              <button className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.12em] text-foreground bg-canvas border border-border">
                <Film className="size-3.5" /> Frames
                <span className="text-foreground-subtle font-bold num">{mediaDone.thumbnail_paths.length}</span>
              </button>
              <span className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.12em] text-foreground-muted">
                <Layers className="size-3.5" /> Saved clips
                <span className="text-foreground-subtle font-bold num">{episodeReplacementsForWorkspace.filter(r => r.generated_audio_path).length}</span>
              </span>
              <div className="flex-1" />
              <span className="text-[11px] text-foreground-subtle num pr-3 border-r border-border mr-3">
                Active episode
              </span>
              {activeProjectId && projectClipCount > 0 && (
                <a href={api.projectClipsZipUrl(activeProjectId)} target="_blank" rel="noreferrer" className="h-7 px-2.5 rounded-md text-[12px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas transition-colors flex items-center gap-1.5">
                  <Download className="size-3.5" /> Export bundle
                </a>
              )}
            </div>
            <div className="px-8 py-4 flex gap-3 overflow-x-auto pb-2 min-w-0">
              {mediaDone.thumbnail_paths.length > 0 ? mediaDone.thumbnail_paths.map((rel, i) => (
                <figure key={rel} className="shrink-0 group cursor-pointer">
                  <div className="w-[156px] aspect-video rounded-md overflow-hidden bg-canvas relative ring-1 ring-border group-hover:ring-border-strong transition-all">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(rel)} alt={`Frame ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  {transcriptEpisodeId && projectRoster.length > 0 && (
                    <select className="absolute bottom-1 left-1 right-1 rounded-md border border-border bg-surface/90 backdrop-blur-sm px-1 py-1 text-[10px] font-medium text-foreground disabled:opacity-50" defaultValue="" disabled={avatarBusyIndex === i} onChange={(e) => {
                      const cid = e.target.value; if (!cid || !transcriptEpisodeId) return; if (avatarBusyIndex !== null) { e.target.value = ""; return; }
                      const selectEl = e.target; setAvatarBusyIndex(i);
                      void (async () => { try { await api.setCharacterAvatarFromEpisodeThumb(cid, { episode_id: transcriptEpisodeId, thumb_index: i }); toast("Character photo updated"); } catch { toast("Could not update character photo"); } finally { selectEl.value = ""; setAvatarBusyIndex(null); } })();
                    }}>
                      <option value="">{avatarBusyIndex === i ? "Updating..." : "Set as character photo"}</option>
                      {projectRoster.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  </div>
                  <figcaption className="mt-1.5 text-[11px] font-medium text-foreground-subtle">Set as character photo</figcaption>
                </figure>
              )) : (
                <div className="flex items-center text-[12px] text-foreground-subtle">
                  {activeEpisodeRecord?.media_type === "audio" ? "Audio-only import. No video frames." : "No frames extracted."}
                </div>
              )}
            </div>
          </section>
        )}
        </>
      ) : null}

      {sourceVoiceModalChar && (
        <SourceVoiceModal characterName={sourceVoiceModalChar.name} busy={sourceVoiceBusy} onConfirm={handleEnableSourceVoice} onCancel={() => setSourceVoiceModalChar(null)} />
      )}

      <ConfirmModal open={!!confirmDeleteSegId} title="Remove transcript line" confirmLabel="Remove" danger onConfirm={() => void executeDeleteSegment()} onCancel={() => setConfirmDeleteSegId(null)}>
        <p>Remove this line from the transcript? It will be hidden from exports and generation.</p>
      </ConfirmModal>
    </div>
  );
}
