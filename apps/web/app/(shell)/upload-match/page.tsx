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
  FileText,
  FileVideo,
  GitMerge,
  Mic2,
  MoreHorizontal,
  Pencil,
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
  const [generatingSegmentId, setGeneratingSegmentId] = useState<string | null>(
    null,
  );
  const uploadSessionRef = useRef(0);
  const progressTrustRef = useRef({
    lastP: -1,
    lastMoveAt: 0,
    lastMsg: "",
    lastUpd: "",
  });
  const [importBootKind, setImportBootKind] = useState<
    "none" | "restored" | "fresh"
  >("none");
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
          setPhase("done");
          setImportBootKind("none");
          toast("Import saved to this project");
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
    [toast],
  );

  async function startUpload() {
    if (!activeProjectId || !file) return;
    uploadSessionRef.current += 1;
    const sessionId = uploadSessionRef.current;
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

    /* Do not resume from API while an upload or worker job is in flight (busy is false during poll). */
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
  }, [storageKey, legacyStorageKey, activeProjectId, phase, busy, toast]);

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

  async function generateLineFromTranscript(segmentId: string, text: string) {
    const ep = transcriptEpisodeId;
    const cid = charPickBySegment[segmentId];
    if (!ep || !cid || !text.trim()) {
      setError("Pick a character with a voice and a line to speak.");
      return;
    }
    const ch = projectRoster.find((c) => c.id === cid);
    if (!ch?.default_voice_id) {
      setError(
        "That character needs a voice. Attach one in Voice Studio first.",
      );
      return;
    }
    setGeneratingSegmentId(segmentId);
    setError(null);
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
      toast("Line audio saved to this project");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not generate audio");
    } finally {
      setGeneratingSegmentId(null);
    }
  }

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
            Pulls a transcript and cast candidates from your clip. Confirmed roster
            lives in Characters; voices in Voice Studio; line swaps in Replace Lines
            after at least one voice exists.
          </p>
        </div>
      </div>

      {importBootKind === "restored" && phase === "done" && mediaDone ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          Loaded your saved import for this project from this browser. Upload again
          anytime to start a new run.
        </div>
      ) : null}
      {importBootKind === "fresh" && (phase === "uploading" || phase === "processing") ? (
        <div className="rounded-xl border border-border bg-surface-sunken/60 px-4 py-3 text-sm text-muted-foreground">
          New import run. We will show fresh results here when this job finishes.
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 rounded-2xl border border-border bg-surface p-3 shadow-soft sm:grid-cols-3 lg:grid-cols-6">
        {PIPELINE_ICONS.map((Icon, idx) => {
          const label = PIPELINE_STEPS[idx]!;
          const active = pipelineActiveIndex === idx;
          const past = pipelineActiveIndex > idx;
          return (
            <div
              key={label}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                active
                  ? "bg-primary/10 ring-1 ring-primary/20"
                  : past
                    ? "bg-white/[0.02]"
                    : "opacity-55"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : past
                      ? "bg-surface-sunken text-foreground"
                      : "bg-surface-sunken text-muted-foreground"
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${active ? "motion-safe:animate-pulse" : ""}`}
                  strokeWidth={2.25}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold leading-tight text-foreground">
                  {label}
                </div>
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
                    setImportBootKind("none");
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
                <div className="mt-6 w-full space-y-4 text-left">
                  <div className="flex items-start gap-3">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <Spinner className="h-5 w-5 border-t-primary" />
                      <span className="pointer-events-none absolute inset-0 motion-safe:animate-ping rounded-xl bg-primary/15 [animation-duration:2s]" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {phase === "uploading"
                          ? "Uploading your video…"
                          : job?.message || "Working on your import…"}
                      </p>
                      {phase === "processing" && processingTrust.longWait ? (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Still processing. This can take a little while depending on
                          video length and speech quality. Keep this tab open while we
                          finish processing.
                        </p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          This can take a little while depending on video length and
                          speech quality. Keep this tab open while we finish processing.
                        </p>
                      )}
                      {phase === "processing" && processingTrust.severeStall ? (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                          No progress updates from the server for several minutes. The
                          job may still be working; check API logs or try again if it
                          never finishes.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {phase === "uploading" ? (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{
                          width: `${Math.round(Math.min(1, Math.max(0, uploadRatio)) * 100)}%`,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                      {processingTrust.determinate &&
                      typeof job?.progress === "number" ? (
                        <div
                          className="h-full rounded-full bg-primary/90 transition-[width] duration-500"
                          style={{
                            width: `${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%`,
                          }}
                        />
                      ) : (
                        <div className="relative h-full w-full">
                          <div className="motion-safe:animate-pulse absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-primary/25 via-primary/80 to-primary/25 [animation-duration:1.3s]" />
                        </div>
                      )}
                    </div>
                  )}
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
              {normalizeJobStatus(job.status) === "running" ||
              normalizeJobStatus(job.status) === "queued" ? (
                <div className="flex items-start gap-2">
                  <Spinner className="mt-0.5 h-4 w-4 shrink-0 border-t-muted-foreground" />
                  <p className="text-muted">
                    {job.message || "Working on your import…"}
                  </p>
                </div>
              ) : job.message ? (
                <p className="text-muted">{job.message}</p>
              ) : (
                <p className="text-muted">Working on your import.</p>
              )}
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
              {mediaDone.import_provider === "local" ? (
                <p className="mt-1 text-xs text-muted">
                  Transcript and speakers from on-device analysis.
                  {mediaDone.fallback_reason != null &&
                  mediaDone.fallback_reason !== "" ? (
                    <> {mediaDone.fallback_reason}</>
                  ) : null}
                </p>
              ) : mediaDone.import_provider ? (
                <p className="mt-1 text-xs text-muted">
                  Cast candidates from AI video analysis. Tags are grouped speakers,
                  not guaranteed real-world identities.
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                This import is saved for the active project on your computer.
              </p>
              <div className="mt-2">
                <p className="text-[11px] font-medium text-muted">Frames from this import</p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {mediaDone.thumbnail_paths.map((rel, i) => (
                  <div
                    key={rel}
                    className="overflow-hidden rounded-lg ring-1 ring-white/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(rel)}
                      alt={`Frame ${i + 1}`}
                      className="h-24 w-full object-cover sm:h-28"
                    />
                    <div className="flex flex-col gap-1 border-t border-white/[0.06] bg-black/20 px-2 py-1.5">
                      <a
                        href={mediaUrl(rel)}
                        download={`castweave-frame-${i + 1}.jpg`}
                        className="text-[10px] font-medium text-accent hover:underline"
                      >
                        Download
                      </a>
                      {transcriptEpisodeId && projectRoster.length > 0 ? (
                        <label className="text-[10px] text-muted">
                          <span className="sr-only">Use as character photo</span>
                          <select
                            className="mt-0.5 w-full rounded border border-white/[0.1] bg-canvas/80 px-1 py-0.5 text-[10px] text-text"
                            defaultValue=""
                            onChange={(e) => {
                              const cid = e.target.value;
                              if (!cid || !transcriptEpisodeId) return;
                              void (async () => {
                                try {
                                  await api.setCharacterAvatarFromEpisodeThumb(
                                    cid,
                                    {
                                      episode_id: transcriptEpisodeId,
                                      thumb_index: i,
                                    },
                                  );
                                  toast("Character photo updated");
                                } finally {
                                  e.target.value = "";
                                }
                              })();
                            }}
                          >
                            <option value="">Use as character photo…</option>
                            {projectRoster.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 border-t border-white/[0.06] pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-xl">
                    <h3 className="text-sm font-semibold text-text">
                      Transcript
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Timestamp, speaker tag, and line text.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {showTranscriptSpinner ? (
                      <Badge tone="accent">Loading…</Badge>
                    ) : (
                      <Badge tone="default">
                        {transcriptSegments.length} segments
                      </Badge>
                    )}
                    {transcriptEpisodeId &&
                    transcriptFetchDone &&
                    !transcriptError &&
                    transcriptSegments.length > 0 ? (
                      <div className="flex flex-wrap justify-end gap-2 text-[10px] font-medium">
                        <a
                          href={api.episodeTranscriptExportUrl(
                            transcriptEpisodeId,
                            "txt",
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          Transcript .txt
                        </a>
                        <a
                          href={api.episodeTranscriptExportUrl(
                            transcriptEpisodeId,
                            "srt",
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          Subtitles .srt
                        </a>
                        <a
                          href={api.episodeTranscriptExportUrl(
                            transcriptEpisodeId,
                            "vtt",
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          Subtitles .vtt
                        </a>
                      </div>
                    ) : null}
                  </div>
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
                  <ul className="mt-4 max-h-96 space-y-1 overflow-y-auto rounded-lg bg-white/[0.015] p-2 ring-1 ring-white/[0.05]">
                    {transcriptSegments.map((row) => {
                      const group = speakerGroups.find(
                        (g) => g.speaker_label === row.speaker_label,
                      );
                      const label =
                        group?.display_name ?? row.speaker_label ?? "Unknown";
                      const ep = transcriptEpisodeId;
                      const sel = selectedTranscriptSegmentId === row.segment_id;
                      return (
                        <li
                          key={row.segment_id}
                          className={`rounded-md text-sm transition ${
                            sel ? "bg-accent/10 ring-1 ring-accent/30" : ""
                          }`}
                        >
                          <div className="flex flex-col gap-1.5 px-2.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
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
                                      : row.speaker_label?.startsWith(
                                            "SPEAKER_",
                                          )
                                        ? "accent"
                                        : "default"
                                  }
                                >
                                  {label}
                                </Badge>
                              </div>
                              <p className="mt-1 text-[13px] leading-snug text-text">
                                {row.text}
                              </p>
                            </button>
                            {ep ? (
                              <div className="flex shrink-0 flex-col gap-2 self-start sm:mt-0.5 sm:items-end">
                                {anyCharacterHasVoice ? (
                                  <>
                                    <label className="block text-[10px] font-medium text-muted">
                                      <span className="sr-only">Character</span>
                                      <select
                                        className="max-w-[11rem] rounded-md border border-white/[0.1] bg-canvas/80 px-2 py-1 text-[11px] text-text"
                                        value={charPickBySegment[row.segment_id] ?? ""}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setCharPickBySegment((prev) => ({
                                            ...prev,
                                            [row.segment_id]: v,
                                          }));
                                        }}
                                        onClick={(e: MouseEvent) =>
                                          e.stopPropagation()
                                        }
                                      >
                                        <option value="">Character…</option>
                                        {projectRoster
                                          .filter((c) => c.default_voice_id)
                                          .map((c) => (
                                            <option key={c.id} value={c.id}>
                                              {c.name}
                                            </option>
                                          ))}
                                      </select>
                                    </label>
                                    <div className="flex flex-wrap justify-end gap-1.5">
                                      <button
                                        type="button"
                                        className="rounded-md bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground ring-1 ring-primary/30 disabled:opacity-50"
                                        disabled={
                                          generatingSegmentId === row.segment_id
                                        }
                                        onClick={(e: MouseEvent) => {
                                          e.stopPropagation();
                                          void generateLineFromTranscript(
                                            row.segment_id,
                                            row.text,
                                          );
                                        }}
                                      >
                                        {generatingSegmentId === row.segment_id
                                          ? "Working…"
                                          : "Generate with voice"}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-md bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-text ring-1 ring-white/[0.08] hover:bg-white/[0.1]"
                                        onClick={(e: MouseEvent) => {
                                          e.stopPropagation();
                                          if (editSegmentId === row.segment_id) {
                                            setEditSegmentId(null);
                                            setEditSegmentDraft("");
                                          } else {
                                            setEditSegmentId(row.segment_id);
                                            setEditSegmentDraft(row.text);
                                          }
                                        }}
                                      >
                                        {editSegmentId === row.segment_id
                                          ? "Close edit"
                                          : "Edit then generate"}
                                      </button>
                                    </div>
                                  </>
                                ) : null}
                                <Link
                                  href={`/replace-lines?episode=${encodeURIComponent(ep)}&segment=${encodeURIComponent(row.segment_id)}`}
                                  title={
                                    anyCharacterHasVoice
                                      ? "Advanced: rewrite and refine in Replace Lines"
                                      : "Attach voices first, then open Replace Lines"
                                  }
                                  className={`inline-flex items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition ${
                                    anyCharacterHasVoice
                                      ? "bg-white/[0.06] text-text ring-white/[0.08] hover:bg-white/[0.1]"
                                      : "bg-white/[0.02] text-muted-foreground ring-white/[0.06] hover:bg-white/[0.04]"
                                  }`}
                                  onClick={(e: MouseEvent) => e.stopPropagation()}
                                >
                                  Use in Replace Lines
                                </Link>
                              </div>
                            ) : null}
                          </div>
                          {editSegmentId === row.segment_id ? (
                            <div className="border-t border-white/[0.06] px-2.5 py-2">
                              <label className="text-[10px] font-medium text-muted">
                                Text to speak
                                <textarea
                                  className="mt-1 w-full rounded-md border border-white/[0.12] bg-canvas/80 px-2 py-1.5 text-[13px] text-text"
                                  rows={3}
                                  value={editSegmentDraft}
                                  onChange={(e) =>
                                    setEditSegmentDraft(e.target.value)
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="mt-2 rounded-md bg-primary/90 px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                                disabled={
                                  generatingSegmentId === row.segment_id
                                }
                                onClick={() =>
                                  void generateLineFromTranscript(
                                    row.segment_id,
                                    editSegmentDraft,
                                  )
                                }
                              >
                                {generatingSegmentId === row.segment_id
                                  ? "Generating…"
                                  : "Generate edited line"}
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {mediaDone && transcriptFetchDone ? (
              <div className="mt-8 border-t border-white/[0.08] pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 max-w-xl items-start gap-2">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div>
                    <h3 className="text-sm font-semibold text-text">
                      Detected cast
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      <span className="font-medium text-text/85">Rename</span> only
                      fixes the label for this import.
                      <span className="font-medium text-text/85">
                        {" "}
                        Create character
                      </span>{" "}
                      adds a real roster entry in this project. Then attach a voice
                      in Voice Studio.
                    </p>
                  </div>
                </div>
                {speakerGroupsLoading ? (
                  <Badge tone="accent">Loading…</Badge>
                ) : (
                  <Badge tone="default">
                    {visibleCastGroups.length} speaker
                    {visibleCastGroups.length === 1 ? "" : "s"}
                    {ignoredLabels.size > 0
                      ? ` · ${ignoredLabels.size} skipped`
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
              {!speakerGroupsLoading && speakerGroups.length > 0 ? (
                <div className="mt-4 rounded-xl bg-white/[0.03] p-3 ring-1 ring-accent/20 sm:p-3">
                  <ul className="space-y-2">
                  {visibleCastGroups.map((g) => {
                    const created = createdChars[g.speaker_label];
                    const others = visibleCastGroups
                      .filter((x) => x.speaker_label !== g.speaker_label)
                      .map((x) => x.speaker_label);
                    const mergePick =
                      mergeTargetFor[g.speaker_label] ?? others[0] ?? "";
                    return (
                    <li
                      key={g.speaker_label}
                      id={speakerRowDomId(g.speaker_label)}
                      className="scroll-mt-24 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06]"
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <Mic2 className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          {editingLabel === g.speaker_label ? (
                            <form
                              className="flex flex-wrap items-center gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void handleRename(g.speaker_label, editValue);
                              }}
                            >
                              <input
                                className="min-w-[10rem] flex-1 rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
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
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
                            </div>
                          )}
                          <p className="mt-1 text-[11px] text-muted">
                            {g.segment_count} segments ·{" "}
                            {g.total_speaking_duration.toFixed(1)}s
                          </p>
                          {g.sample_texts.length > 0 ? (
                            <div className="mt-2 space-y-0.5">
                              {g.sample_texts.slice(0, 3).map((t, i) => (
                                <p
                                  key={i}
                                  className="line-clamp-2 text-xs italic text-muted"
                                >
                                  &ldquo;{t}&rdquo;
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {created ? (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400/95">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            Character created
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/voice-studio?character=${encodeURIComponent(created.id)}&panel=voice&focus=attach`}
                              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-glow transition hover:opacity-90"
                            >
                              <Volume2 className="h-3.5 w-3.5" />
                              Attach voice
                            </Link>
                            <Link
                              href={`/voice-studio?character=${encodeURIComponent(created.id)}&panel=voice`}
                              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white/[0.08] px-3 text-xs font-semibold text-text ring-1 ring-white/[0.1] transition hover:bg-white/[0.12]"
                            >
                              Open Voice Studio
                            </Link>
                            <Button
                              variant="secondary"
                              className="!px-2.5 !py-1.5 !text-xs"
                              onClick={() => {
                                setEditingLabel(g.speaker_label);
                                setEditValue(g.display_name);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                              Rename
                            </Button>
                          </div>
                        </div>
                      ) : creatingLabel === g.speaker_label ? (
                        <form
                          className="mt-3 flex flex-wrap items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleCreateCharacter(
                              g.speaker_label,
                              charNameInput,
                            );
                          }}
                        >
                          <input
                            className="min-w-[10rem] flex-1 rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1.5 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                            placeholder="Character name"
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
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            className="!px-2.5 !py-1.5 !text-xs"
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
                            className="!px-2.5 !py-1.5 !text-xs"
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
                          <Button
                            variant="secondary"
                            className="!px-2.5 !py-1.5 !text-xs"
                            onClick={() => toggleIgnore(g.speaker_label)}
                          >
                            Skip
                          </Button>
                        </div>
                      )}

                      {editingLabel !== g.speaker_label ? (
                        <details className="group mt-2 border-t border-white/[0.06] pt-2">
                          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted hover:text-text [&::-webkit-details-marker]:hidden">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                            More
                          </summary>
                          <div className="mt-2 flex flex-col gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              className="w-full justify-start !px-2.5 !py-1.5 !text-xs sm:w-auto"
                              onClick={() =>
                                void handleNarrator(
                                  g.speaker_label,
                                  !g.is_narrator,
                                )
                              }
                            >
                              {g.is_narrator
                                ? "Unmark narrator / off-screen"
                                : "Mark narrator / off-screen"}
                            </Button>
                            {others.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-muted">
                                  Merge duplicate
                                </span>
                                <select
                                  className="rounded-lg border border-white/[0.12] bg-canvas/80 px-2 py-1.5 text-xs text-text outline-none focus:border-accent/40"
                                  value={mergePick}
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
                                  disabled={mergeBusy || !mergePick}
                                  onClick={() =>
                                    void runMerge(g.speaker_label, mergePick)
                                  }
                                >
                                  <GitMerge className="h-3 w-3" />
                                  Merge
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      ) : null}
                    </li>
                    );
                  })}
                  </ul>
                </div>
              ) : null}
              {ignoredLabels.size > 0 ? (
                <details className="mt-3 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06]">
                  <summary className="cursor-pointer list-none text-xs font-medium text-muted hover:text-text [&::-webkit-details-marker]:hidden">
                    Skipped ({ignoredLabels.size})
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
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
                </details>
              ) : null}
              {transcriptEpisodeId && transcriptSegments.length > 0 ? (
                <div
                  className={`mt-4 rounded-xl px-4 py-3 ${
                    anyCharacterHasVoice
                      ? "border border-emerald-500/25 bg-emerald-500/5"
                      : "border border-white/[0.08] bg-white/[0.02]"
                  }`}
                >
                  {anyCharacterHasVoice ? (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        Voices are on the roster. You can swap lines in Replace
                        Lines when you&apos;re ready.
                      </p>
                      <Link
                        href={`/replace-lines?episode=${encodeURIComponent(transcriptEpisodeId)}`}
                        className="mt-2 inline-flex text-sm font-semibold text-accent underline-offset-4 hover:underline"
                      >
                        Open Replace Lines
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Replace Lines
                        </span>{" "}
                        works best after at least one character has a voice in
                        Voice Studio. Finish cast setup above first.
                      </p>
                      <Link
                        href={`/replace-lines?episode=${encodeURIComponent(transcriptEpisodeId)}`}
                        className="mt-2 inline-flex text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Open Replace Lines anyway
                      </Link>
                    </>
                  )}
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
        CastWeave · Video to cast, voice, and lines.
      </footer>
    </div>
  );
}
