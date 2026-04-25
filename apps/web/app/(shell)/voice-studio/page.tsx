"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  LayoutGrid,
  Library,
  Mic2,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  DesignVoiceResponseDto,
  PreviewDto,
  RemixVoiceResponseDto,
  UserVoiceDto,
  VoiceCatalogResponse,
  VoiceClipDto,
} from "@/lib/api/types";
import VoiceRecorder from "@/components/ui/VoiceRecorder";
import VoiceUploader from "@/components/ui/VoiceUploader";
import { useProjects } from "@/components/providers/ProjectProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { playVoicePreview, stopVoicePreview } from "@/lib/audio/voicePreviewPlayer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Spinner } from "@/components/ui/Spinner";

type StudioSection = "voice" | "draft" | "clips";
type DirectInputMode = "single_line" | "multi_line";
type ReviewLine = {
  id: string;
  text: string;
  tone_style: string;
};
type ActiveStep = "summary" | "draft" | "review" | "generate" | "clips";
type VoiceTab = "catalog" | "saved" | "project";

/** Keep in sync with apps/api/schemas/character.py PROMPT_MAX_CHARS */
const SCENE_PROMPT_MAX_CHARS = 600;

const VOICE_SWATCHES = [
  "from-emerald-400/30 to-emerald-700/40",
  "from-amber-300/30 to-amber-600/40",
  "from-sky-300/30 to-sky-600/40",
  "from-rose-300/30 to-rose-600/40",
  "from-indigo-300/30 to-indigo-600/40",
  "from-violet-300/30 to-violet-600/40",
  "from-teal-300/30 to-teal-600/40",
  "from-orange-300/30 to-orange-600/40",
];

function voiceSwatch(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return VOICE_SWATCHES[Math.abs(hash) % VOICE_SWATCHES.length]!;
}

function Waveform({ bars = 24, className = "" }: { bars?: number; className?: string }) {
  const heights = Array.from({ length: bars }, (_, i) =>
    4 + Math.abs(Math.sin(i * 0.7)) * 18 + ((i * 13) % 7),
  );
  return (
    <div className={`flex items-end gap-[2px] h-7 ${className}`}>
      {heights.map((h, i) => (
        <span key={i} className="w-[2.5px] rounded-full bg-foreground/40" style={{ height: `${h}px` }} />
      ))}
    </div>
  );
}

function audioSrcFromApiPath(url: string): string {
  const trimmed = url.replace(/^\/media\//, "");
  return mediaUrl(trimmed);
}

function characterAvatarSrc(c: CharacterDto): string | null {
  const rel = c.thumbnail_paths?.[0];
  if (!rel) return null;
  return mediaUrl(rel.replace(/^\/media\//, ""));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function VoiceStudioContent() {
  const toast = useToast();
  const router = useRouter();
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    loading: projectsLoading,
  } = useProjects();
  const searchParams = useSearchParams();
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [voiceHub, setVoiceHub] = useState<VoiceCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [voiceSearchInput, setVoiceSearchInput] = useState("");

  const [userVoices, setUserVoices] = useState<UserVoiceDto[]>([]);
  const [showAddVoiceModal, setShowAddVoiceModal] = useState(false);
  const [addVoiceTab, setAddVoiceTab] = useState<"record" | "upload">("record");
  const [addVoiceName, setAddVoiceName] = useState("");
  const [addVoiceRights, setAddVoiceRights] = useState<"my_voice" | "have_permission">("my_voice");
  const [addVoiceRightsNote, setAddVoiceRightsNote] = useState("");
  const [addVoiceConfirmed, setAddVoiceConfirmed] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosenVoiceId, setChosenVoiceId] = useState<string>("");
  const [rowPreviewBusyId, setRowPreviewBusyId] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<PreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [designDesc, setDesignDesc] = useState("");
  const [designPreviewText, setDesignPreviewText] = useState("");
  const [designVoiceName, setDesignVoiceName] = useState("Custom voice");
  const [designLoading, setDesignLoading] = useState(false);
  const [designResult, setDesignResult] = useState<DesignVoiceResponseDto | null>(null);
  const [designPickGid, setDesignPickGid] = useState<string | null>(null);
  const [designErr, setDesignErr] = useState<string | null>(null);
  const [designSaveLoading, setDesignSaveLoading] = useState(false);

  const [remixPrompt, setRemixPrompt] = useState("");
  const [remixPreviewText, setRemixPreviewText] = useState("");
  const [remixVoiceName, setRemixVoiceName] = useState("Remixed voice");
  const [remixLoading, setRemixLoading] = useState(false);
  const [remixResult, setRemixResult] = useState<RemixVoiceResponseDto | null>(null);
  const [remixPickGid, setRemixPickGid] = useState<string | null>(null);
  const [remixErr, setRemixErr] = useState<string | null>(null);
  const [remixSaveLoading, setRemixSaveLoading] = useState(false);

  const [clips, setClips] = useState<VoiceClipDto[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [clipLabel, setClipLabel] = useState("");
  const [clipBusyId, setClipBusyId] = useState<string | null>(null);
  const [confirmDeleteClipId, setConfirmDeleteClipId] = useState<string | null>(null);
  const [directInputMode, setDirectInputMode] = useState<DirectInputMode>("single_line");
  const [directLinesInput, setDirectLinesInput] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [promptLines, setPromptLines] = useState<ReviewLine[]>([]);
  const [promptLinesBusy, setPromptLinesBusy] = useState(false);
  const [showDirectTextAdvanced, setShowDirectTextAdvanced] = useState(false);
  const [studioSection, setStudioSection] = useState<StudioSection>("draft");
  const [activeStep, setActiveStep] = useState<ActiveStep>("summary");
  const [freshClipIds, setFreshClipIds] = useState<Set<string>>(new Set());
  const [playingVoice, setPlayingVoice] = useState(false);
  const reviewSectionRef = useRef<HTMLDivElement | null>(null);
  const clipsSectionRef = useRef<HTMLDivElement | null>(null);

  const [voiceTab, setVoiceTab] = useState<VoiceTab>("project");
  const [attachDropdownId, setAttachDropdownId] = useState<string | null>(null);

  useEffect(() => {
    return () => stopVoicePreview();
  }, []);

  useEffect(() => {
    const q = searchParams.get("character");
    if (q?.trim()) setSelectedId(q.trim());
  }, [searchParams]);

  useEffect(() => {
    if (loading || projectsLoading) return;
    if (!activeProjectId) {
      setSelectedId(null);
      return;
    }
    if (characters.length === 0) {
      setSelectedId(null);
      return;
    }
    const q = searchParams.get("character")?.trim();
    if (q && characters.some((c) => c.id === q)) {
      setSelectedId(q);
      return;
    }
    if (q) {
      setSelectedId(characters[0]!.id);
      return;
    }
    setSelectedId((current) =>
      current && characters.some((c) => c.id === current)
        ? current
        : characters[0]!.id,
    );
  }, [loading, projectsLoading, activeProjectId, characters, searchParams]);

  useEffect(() => {
    if (!selectedId) return;
    const panel = (searchParams.get("panel") || "").trim().toLowerCase();

    if (panel === "voice") {
      setStudioSection("voice");
    } else if (panel === "clips") {
      setStudioSection("clips");
    }
  }, [searchParams, selectedId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(voiceSearchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [voiceSearchInput]);

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
          setError(e instanceof ApiError ? e.message : "Failed to load characters");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setVoiceHub(null);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    const req =
      debouncedSearch.length > 0
        ? api.searchVoiceCatalog({
            q: debouncedSearch,
            page: 1,
            page_size: 100,
          })
        : api.listVoiceCatalog({ page: 1, page_size: 100 });
    req
      .then((res) => {
        if (!cancelled) setVoiceHub(res);
      })
      .catch((e) => {
        if (!cancelled)
          setCatalogError(
            e instanceof ApiError ? e.message : "Failed to load voices",
          );
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, debouncedSearch]);

  useEffect(() => {
    api.listUserVoices().then(setUserVoices).catch(() => {});
  }, []);

  const refreshUserVoices = () => {
    api.listUserVoices().then(setUserVoices).catch(() => {});
  };

  const selected = characters.find((c) => c.id === selectedId) ?? null;

  const focusAttach =
    (searchParams.get("focus") || "").trim().toLowerCase() === "attach";

  const pageSubtitle = useMemo(() => {
    const ch = characters.find((c) => c.id === selectedId);
    if (focusAttach && ch && !ch.default_voice_id) {
      return `Attaching a voice to ${ch.name}. Pick a catalog voice or design one.`;
    }
    return "Your full voice library: catalog, saved voices, and project voices";
  }, [focusAttach, selectedId, characters]);

  useEffect(() => {
    setDesignDesc("");
    setDesignPreviewText("");
    setDesignVoiceName("Custom voice");
    setDesignResult(null);
    setDesignPickGid(null);
    setDesignErr(null);
    setRemixPrompt("");
    setRemixPreviewText("");
    setRemixVoiceName("Remixed voice");
    setRemixResult(null);
    setRemixPickGid(null);
    setRemixErr(null);
    setClipLabel("");
    setDirectInputMode("single_line");
    setDirectLinesInput("");
    setPromptInput("");
    setPromptLines([]);
    setPromptLinesBusy(false);
    setShowDirectTextAdvanced(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setClips([]);
      return;
    }
    let cancelled = false;
    setClipsLoading(true);
    void api
      .listCharacterClips(selectedId)
      .then((rows) => {
        if (!cancelled) setClips(rows);
      })
      .catch(() => {
        if (!cancelled) setClips([]);
      })
      .finally(() => {
        if (!cancelled) setClipsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    const c = characters.find((x) => x.id === selectedId);
    if (!c) return;
    setChosenVoiceId(c.default_voice_id ?? "");
    setSampleText(c.sample_texts[0] ?? "");
    setPreview(null);
    setPreviewError(null);
    setSaveSuccess(false);
    const panel = (searchParams.get("panel") || "").trim().toLowerCase();
    if (panel === "voice") {
      setStudioSection("voice");
      return;
    }
    if (panel === "clips") {
      setStudioSection("clips");
      return;
    }
    if (c.default_voice_id) {
      setStudioSection("draft");
    } else {
      setStudioSection("voice");
    }
  }, [selectedId, characters, searchParams]);

  useEffect(() => {
    if (selectedId) setActiveStep("summary");
  }, [selectedId]);

  async function handleAssignVoice() {
    if (saving) return;
    if (!selected || !chosenVoiceId || !voiceHub) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const picked = voiceHub.voices.find((v) => v.voice_id === chosenVoiceId);
      const updated = await api.assignVoice(selected.id, {
        voice_id: chosenVoiceId,
        provider:
          voiceHub.source === "primary" ? "primary" : "local_builtin",
        display_name: picked?.display_name ?? chosenVoiceId,
        voice_source_type: "catalog",
      });
      setCharacters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      setSaveSuccess(true);
      toast("Voice attached");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to assign voice");
    } finally {
      setSaving(false);
    }
  }

  async function handleAttachVoiceToCharacter(
    characterId: string,
    voiceId: string,
    displayName: string,
    sourceType: string,
  ) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.assignVoice(characterId, {
        voice_id: voiceId,
        provider: voiceHub?.source === "primary" ? "primary" : "local_builtin",
        display_name: displayName,
        voice_source_type: sourceType,
      });
      setCharacters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      const charName = characters.find((c) => c.id === characterId)?.name || "character";
      toast(`Voice attached to ${charName}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to assign voice");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateDirectClips() {
    if (!selected) return;
    if (!selected.default_voice_id) {
      setPreviewError("Assign a voice first in Voice setup.");
      return;
    }
    const lines =
      directInputMode === "single_line"
        ? [sampleText.trim()].filter(Boolean)
        : directLinesInput
            .split(/\r?\n/)
            .map((ln) => ln.trim())
            .filter(Boolean);
    if (lines.length === 0) return;

    setGenerating(true);
    setActiveStep("generate");
    setPreview(null);
    setPreviewError(null);
    try {
      const oldIds = new Set(clips.map((c) => c.id));
      await api.generateCharacterClipsFromLines(selected.id, {
        lines: lines.map((text) => ({ text, tone_style: "" })),
        clip_label_prefix: clipLabel.trim() || undefined,
        voice_id: selected.default_voice_id || undefined,
      });
      const rows = await api.listCharacterClips(selected.id);
      setClips(rows);
      const createdIds = rows
        .filter((c) => !oldIds.has(c.id))
        .map((c) => c.id);
      if (createdIds.length > 0) {
        setFreshClipIds(new Set(createdIds));
        setActiveStep("clips");
        setStudioSection("clips");
        setTimeout(() => {
          clipsSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 120);
        setTimeout(() => setFreshClipIds(new Set()), 2600);
      }
      if (directInputMode === "multi_line") setDirectLinesInput("");
      else setSampleText("");
      toast("Clips saved to this character");
      void trackUsage("line_gens", lines.length);
    } catch (e) {
      setPreviewError(
        e instanceof ApiError ? e.message : "Direct clip generation failed",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateLinesFromPrompt() {
    if (!selected || !promptInput.trim()) return;
    const trimmed = promptInput.trim();
    if (trimmed.length > SCENE_PROMPT_MAX_CHARS) {
      setPreviewError(
        `Scene prompt is too long (max ${SCENE_PROMPT_MAX_CHARS} characters).`,
      );
      return;
    }
    setPromptLinesBusy(true);
    setActiveStep("draft");
    setPreviewError(null);
    try {
      const res = await api.generateCharacterDraftLines(selected.id, {
        prompt: trimmed,
      });
      setPromptLines(
        res.lines.map((line, idx) => ({
          id: `draft-${idx}-${Date.now()}`,
          text: line.text,
          tone_style: line.tone_style || "",
        })),
      );
      setActiveStep("review");
      setStudioSection("draft");
      setTimeout(() => {
        reviewSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 120);
    } catch (e) {
      setPreviewError(
        e instanceof ApiError ? e.message : "Could not generate lines from prompt",
      );
    } finally {
      setPromptLinesBusy(false);
    }
  }

  async function handleGeneratePromptClips() {
    if (!selected) return;
    if (!selected.default_voice_id) {
      setPreviewError("Assign a voice first in Voice setup.");
      return;
    }
    const lines = promptLines
      .map((x) => ({ text: x.text.trim(), tone_style: "" }))
      .filter((x) => x.text);
    if (lines.length === 0) {
      setPreviewError("Generate and keep at least one line before audio generation.");
      return;
    }
    setGenerating(true);
    setActiveStep("generate");
    setPreview(null);
    setPreviewError(null);
    try {
      const oldIds = new Set(clips.map((c) => c.id));
      await api.generateCharacterClipsFromLines(selected.id, {
        lines,
        voice_id: selected.default_voice_id || undefined,
      });
      const rows = await api.listCharacterClips(selected.id);
      setClips(rows);
      const createdIds = rows
        .filter((c) => !oldIds.has(c.id))
        .map((c) => c.id);
      if (createdIds.length > 0) {
        setFreshClipIds(new Set(createdIds));
        setActiveStep("clips");
        setStudioSection("clips");
        setTimeout(() => {
          clipsSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 120);
        setTimeout(() => setFreshClipIds(new Set()), 2600);
      }
      void trackUsage("line_gens", lines.length);
    } catch (e) {
      setPreviewError(
        e instanceof ApiError ? e.message : "Prompt clip generation failed",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleRenameClip(clip: VoiceClipDto, title: string) {
    setClipBusyId(clip.id);
    try {
      const updated = await api.patchVoiceClip(clip.id, { title: title.trim() });
      setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      /* keep UI stable */
    } finally {
      setClipBusyId(null);
    }
  }

  function handleDeleteClip(clipId: string) {
    setConfirmDeleteClipId(clipId);
  }

  async function executeDeleteClip() {
    const clipId = confirmDeleteClipId;
    if (!clipId) return;
    setConfirmDeleteClipId(null);
    setClipBusyId(clipId);
    try {
      await api.deleteVoiceClip(clipId);
      setClips((prev) => prev.filter((c) => c.id !== clipId));
    } finally {
      setClipBusyId(null);
    }
  }

  async function previewVoiceRow(voiceId: string) {
    if (!selected?.id || rowPreviewBusyId) return;
    setRowPreviewBusyId(voiceId);
    try {
      const txt =
        sampleText.trim() || "This is a short preview of this voice.";
      const result = await api.generatePreview(selected.id, {
        text: txt,
        voice_id: voiceId,
        save_clip: false,
      });
      await playVoicePreview(
        mediaUrl(result.audio_url.replace(/^\/media\//, "")),
      );
    } catch (e) {
      toast(
        e instanceof ApiError ? e.message : "Could not preview this voice",
      );
    } finally {
      setRowPreviewBusyId(null);
    }
  }

  async function handlePlayCharacterVoice() {
    if (!selected?.default_voice_id || playingVoice) return;
    setPlayingVoice(true);
    try {
      const existingPreview = (selected.preview_audio_path || "").trim();
      if (existingPreview) {
        const rel = existingPreview.replace(/^\/media\//, "");
        await playVoicePreview(mediaUrl(rel));
        return;
      }

      const result = await api.generatePreview(selected.id, {
        text: "This is a short preview of the attached voice.",
        voice_id: selected.default_voice_id,
        save_clip: false,
      });
      await playVoicePreview(
        mediaUrl(result.audio_url.replace(/^\/media\//, "")),
      );
    } catch {
      /* Keep button behavior resilient */
    } finally {
      setPlayingVoice(false);
    }
  }

  const allVoices = voiceHub?.voices ?? [];
  const projectVoiceIds = new Set(characters.filter((c) => c.default_voice_id).map((c) => c.default_voice_id!));
  const projectVoices = allVoices.filter((v) => projectVoiceIds.has(v.voice_id));
  const catalogVoices = allVoices.filter((v) => !projectVoiceIds.has(v.voice_id));

  const remixEligible =
    !!selected?.default_voice_id &&
    (selected.voice_source_type === "designed" ||
      selected.voice_source_type === "remixed");

  function handleVoiceStudioProjectChange(id: string) {
    if (!id || id === activeProjectId) return;
    setActiveProjectId(id);
    router.replace("/voice-studio");
  }

  async function trackUsage(field: string, amount = 1) {
    try {
      await fetch("/api/billing/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, amount }),
      });
    } catch { /* non-blocking */ }
  }

  async function handleDesignGenerate() {
    if (designLoading) return;
    if (!selected || !designDesc.trim()) return;
    setDesignLoading(true);
    setDesignErr(null);
    setDesignResult(null);
    setDesignPickGid(null);
    try {
      const res = await api.designVoice({
        voice_description: designDesc.trim(),
        preview_text: designPreviewText.trim() || " ",
      });
      setDesignResult(res);
      if (res.candidates[0]) setDesignPickGid(res.candidates[0].generated_voice_id);
      void trackUsage("preview_gens");
    } catch (e) {
      setDesignErr(
        e instanceof ApiError ? e.message : "Voice design request failed",
      );
    } finally {
      setDesignLoading(false);
    }
  }

  async function handleDesignSave() {
    if (designSaveLoading) return;
    if (!selected || !designPickGid || !designVoiceName.trim()) return;
    setDesignSaveLoading(true);
    setDesignErr(null);
    try {
      await api.saveDesignedVoice({
        character_id: selected.id,
        generated_voice_id: designPickGid,
        voice_name: designVoiceName.trim(),
        voice_description: designDesc.trim() || "Custom voice",
      });
      const fresh = await api.getCharacter(selected.id);
      setCharacters((prev) =>
        prev.map((c) => (c.id === fresh.id ? fresh : c)),
      );
      setSaveSuccess(true);
      toast("Designed voice saved");
      void trackUsage("voice_uploads");
    } catch (e) {
      setDesignErr(
        e instanceof ApiError ? e.message : "Could not save designed voice",
      );
    } finally {
      setDesignSaveLoading(false);
    }
  }

  async function handleRemixGenerate() {
    if (remixLoading) return;
    if (!selected?.default_voice_id || !remixPrompt.trim()) return;
    setRemixLoading(true);
    setRemixErr(null);
    setRemixResult(null);
    setRemixPickGid(null);
    try {
      const res = await api.remixVoice(selected.default_voice_id, {
        remix_prompt: remixPrompt.trim(),
        preview_text: remixPreviewText.trim() || " ",
      });
      setRemixResult(res);
      if (res.candidates[0]) setRemixPickGid(res.candidates[0].generated_voice_id);
      void trackUsage("preview_gens");
    } catch (e) {
      setRemixErr(
        e instanceof ApiError ? e.message : "Voice remix request failed",
      );
    } finally {
      setRemixLoading(false);
    }
  }

  async function handleRemixSave() {
    if (remixSaveLoading) return;
    if (
      !selected?.default_voice_id ||
      !remixPickGid ||
      !remixVoiceName.trim()
    )
      return;
    setRemixSaveLoading(true);
    setRemixErr(null);
    try {
      await api.saveRemixedVoice({
        character_id: selected.id,
        generated_voice_id: remixPickGid,
        voice_name: remixVoiceName.trim(),
        voice_description: remixPrompt.trim() || "Remix",
        parent_voice_id: selected.default_voice_id,
      });
      const fresh = await api.getCharacter(selected.id);
      setCharacters((prev) =>
        prev.map((c) => (c.id === fresh.id ? fresh : c)),
      );
      setSaveSuccess(true);
      toast("Voice updated");
      void trackUsage("voice_uploads");
    } catch (e) {
      setRemixErr(
        e instanceof ApiError ? e.message : "Could not save remixed voice",
      );
    } finally {
      setRemixSaveLoading(false);
    }
  }

  /* ──────────────────────────────────────────────────── */
  /* ─── RENDER ─────────────────────────────────────── */
  /* ──────────────────────────────────────────────────── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ───────────────────────────────────── */}
      <header className="h-16 shrink-0 bg-surface border-b border-border flex items-center px-10 gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[18px] font-bold tracking-tight">Voices</h1>
          <span className="text-[11.5px] text-foreground-subtle hidden lg:inline">{pageSubtitle}</span>
        </div>
        <div className="flex-1" />

        <div className="relative">
          <select
            className="h-9 appearance-none rounded-md border border-border bg-canvas pl-3 pr-8 text-[13px] font-semibold text-foreground outline-none focus:border-border-strong"
            value={activeProjectId ?? ""}
            disabled={projectsLoading || projects.length === 0}
            onChange={(e) => handleVoiceStudioProjectChange(e.target.value)}
          >
            {projects.length === 0 ? (
              <option value="">No projects</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-foreground-muted" />
        </div>

        <div className="relative">
          <Search className="size-3.5 text-foreground-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            placeholder="Search voices"
            className="h-9 pl-8 pr-3 w-64 text-[13px] bg-canvas border border-border rounded-md focus:outline-none focus:border-border-strong"
            value={voiceSearchInput}
            onChange={(e) => setVoiceSearchInput(e.target.value)}
          />
        </div>

        <button
          onClick={() => { setShowAddVoiceModal(true); setAddVoiceTab("record"); setAddVoiceName(""); setAddVoiceRights("my_voice"); setAddVoiceRightsNote(""); setAddVoiceConfirmed(false); }}
          className="h-9 px-4 rounded-md text-sm font-semibold bg-foreground text-surface hover:bg-foreground/90 transition-colors flex items-center gap-2 shadow-sm"
        >
          <Plus className="size-4" />
          Add voice
        </button>
      </header>

      {/* ── Tab bar ──────────────────────────────────── */}
      <div className="h-12 shrink-0 bg-canvas border-b border-border px-10 flex items-center gap-1">
        {([
          { id: "catalog" as const, label: "Catalog", count: catalogVoices.length },
          { id: "saved" as const, label: "My voices", count: userVoices.length },
          { id: "project" as const, label: "Project voices", count: characters.length },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setVoiceTab(t.id)}
            className={`h-8 px-3.5 rounded-md flex items-center gap-2 text-[13px] font-semibold transition-colors ${
              voiceTab === t.id
                ? "bg-surface border border-border shadow-xs text-foreground"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {t.label}
            <span className="text-[11px] num text-foreground-subtle">{t.count}</span>
          </button>
        ))}
        <span className="ml-auto text-[12.5px] text-foreground-muted font-medium">Sort: Recommended</span>
      </div>

      {/* ── Banners ──────────────────────────────────── */}
      {error && (
        <div className="mx-8 mt-4"><ErrorBanner title="Voice studio" detail={error} /></div>
      )}
      {focusAttach && selected && !selected.default_voice_id && !loading && !projectsLoading && characters.length > 0 && (
        <div className="mx-8 mt-4 rounded-lg border border-accent bg-accent-soft/30 p-4">
          <p className="text-sm font-semibold text-foreground">Next step: assign or design a voice for {selected.name}</p>
          <p className="mt-1 text-xs text-foreground-muted">Browse the Catalog or go to Project voices to attach a voice.</p>
        </div>
      )}

      {attachDropdownId && (
        <div className="fixed inset-0 z-10" onClick={() => setAttachDropdownId(null)} />
      )}

      {/* ── Main ─────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="px-10 py-8 max-w-[1600px] mx-auto">
          {(projectsLoading || loading) && (
            <div className="grid grid-cols-3 gap-5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="rounded-xl border border-border bg-surface p-4">
                  <Skeleton className="h-24 w-full rounded-lg" />
                  <Skeleton className="mt-3 h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              ))}
            </div>
          )}

          {!activeProjectId && !projectsLoading && (
            <EmptyState icon={Mic2} title="Pick a project" description="Create a project first, then choose it in the header." />
          )}

          {/* ── CATALOG TAB ────────────────────────────── */}
          {voiceTab === "catalog" && !loading && !projectsLoading && activeProjectId && (
            <>
              <div className="mb-6">
                <h2 className="text-[22px] font-bold tracking-tight">Catalog voices</h2>
                <p className="text-[13.5px] text-foreground-muted mt-1">
                  Curated voices ready to attach to any character.{voiceHub ? ` ${voiceHub.total} voices available.` : ""}
                </p>
              </div>
              {catalogLoading ? (
                <div className="grid grid-cols-3 gap-5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-xl border border-border bg-surface p-4">
                      <Skeleton className="h-24 w-full rounded-lg" />
                      <Skeleton className="mt-3 h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : catalogError ? (
                <ErrorBanner title="Catalog" detail={catalogError} />
              ) : catalogVoices.length === 0 ? (
                <p className="text-sm text-foreground-muted">No catalog voices found{debouncedSearch ? ` for "${debouncedSearch}"` : ""}.</p>
              ) : (
                <div className="grid grid-cols-3 gap-5">
                  {catalogVoices.map((v) => (
                    <article key={v.voice_id} className="bg-surface border border-border rounded-xl overflow-hidden hover:border-border-strong hover:shadow-sm transition-all flex flex-col">
                      <div className={`h-24 bg-gradient-to-br ${voiceSwatch(v.display_name)} relative px-4 flex items-end pb-3`}>
                        <Waveform bars={28} className="opacity-70" />
                        <button
                          onClick={() => void previewVoiceRow(v.voice_id)}
                          disabled={rowPreviewBusyId !== null}
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-12 rounded-full bg-foreground text-surface flex items-center justify-center shadow-md hover:scale-105 transition-transform disabled:opacity-60"
                        >
                          {rowPreviewBusyId === v.voice_id ? (
                            <Spinner className="h-5 w-5 border-t-surface" />
                          ) : (
                            <Play className="size-5 fill-current ml-0.5" />
                          )}
                        </button>
                      </div>
                      <div className="p-4 flex flex-col gap-3 flex-1">
                        <div>
                          <h3 className="font-bold text-[15px] tracking-tight">{v.display_name}</h3>
                          {v.description && <p className="text-[12.5px] text-foreground-muted mt-0.5 leading-snug line-clamp-2">{v.description}</p>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {v.tags?.map((tag) => (
                            <span key={tag} className="text-[10.5px] font-semibold text-foreground-muted bg-canvas border border-border px-1.5 py-0.5 rounded">{tag}</span>
                          ))}
                          {v.category && (
                            <span className="text-[10.5px] font-semibold text-foreground-muted bg-canvas border border-border px-1.5 py-0.5 rounded capitalize">{v.category}</span>
                          )}
                        </div>
                        <div className="relative mt-auto pt-1">
                          {characters.length > 0 ? (
                            <>
                              <button
                                onClick={() => setAttachDropdownId(attachDropdownId === v.voice_id ? null : v.voice_id)}
                                className="w-full h-9 rounded-md text-[12.5px] font-bold bg-foreground text-surface hover:bg-foreground/90 flex items-center justify-center gap-1.5"
                              >
                                Attach to character
                              </button>
                              {attachDropdownId === v.voice_id && (
                                <div className="absolute left-0 right-0 bottom-full mb-1 bg-surface border border-border rounded-lg shadow-md z-20 py-1 max-h-48 overflow-y-auto">
                                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Attach to</p>
                                  {characters.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      className="w-full text-left px-3 py-2 text-[13px] hover:bg-canvas truncate"
                                      onClick={() => {
                                        setAttachDropdownId(null);
                                        void handleAttachVoiceToCharacter(c.id, v.voice_id, v.display_name, "catalog");
                                      }}
                                    >
                                      {c.name}
                                      {c.default_voice_id === v.voice_id && <CheckCircle2 className="inline ml-2 size-3.5 text-success" />}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-foreground-muted text-center">No characters to attach to</p>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── MY VOICES TAB ──────────────────────────── */}
          {voiceTab === "saved" && !projectsLoading && (
            <>
              <div className="mb-6">
                <h2 className="text-[22px] font-bold tracking-tight">My saved voices</h2>
                <p className="text-[13.5px] text-foreground-muted mt-1">Voices you have uploaded, recorded, or designed.</p>
              </div>
              <div className="grid grid-cols-3 gap-5">
                {userVoices.map((uv) => (
                  <article key={uv.id} className="bg-surface border border-border rounded-xl overflow-hidden hover:border-border-strong hover:shadow-sm transition-all flex flex-col">
                    <div className={`h-24 bg-gradient-to-br ${voiceSwatch(uv.name)} relative px-4 flex items-end pb-3`}>
                      <Waveform bars={28} className="opacity-70" />
                      {uv.preview_url && (
                        <button
                          onClick={() => playVoicePreview(audioSrcFromApiPath(uv.preview_url!))}
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-12 rounded-full bg-foreground text-surface flex items-center justify-center shadow-md hover:scale-105 transition-transform"
                        >
                          <Play className="size-5 fill-current ml-0.5" />
                        </button>
                      )}
                    </div>
                    <div className="p-4 flex flex-col gap-3 flex-1">
                      <div>
                        <h3 className="font-bold text-[15px] tracking-tight">{uv.name}</h3>
                        <p className="text-[12.5px] text-foreground-muted mt-0.5 capitalize">{uv.source_type}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10.5px] font-semibold text-foreground-muted bg-canvas border border-border px-1.5 py-0.5 rounded capitalize">{uv.source_type}</span>
                      </div>
                      <div className="mt-auto pt-1 flex items-center gap-2">
                        {characters.length > 0 && uv.elevenlabs_voice_id && (
                          <div className="relative flex-1">
                            <button
                              onClick={() => setAttachDropdownId(attachDropdownId === `uv-${uv.id}` ? null : `uv-${uv.id}`)}
                              className="w-full h-9 rounded-md text-[12.5px] font-bold bg-foreground text-surface hover:bg-foreground/90"
                            >
                              Attach
                            </button>
                            {attachDropdownId === `uv-${uv.id}` && (
                              <div className="absolute left-0 right-0 bottom-full mb-1 bg-surface border border-border rounded-lg shadow-md z-20 py-1 max-h-48 overflow-y-auto">
                                {characters.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-canvas truncate"
                                    onClick={async () => {
                                      setAttachDropdownId(null);
                                      try {
                                        const updated = await api.patchCharacter(c.id, {
                                          default_voice_id: uv.elevenlabs_voice_id!,
                                          voice_provider: "primary",
                                          voice_display_name: uv.name,
                                          voice_source_type: uv.source_type === "recorded" ? "recorded" : "uploaded",
                                        });
                                        setCharacters((prev) => prev.map((x) => x.id === updated.id ? updated : x));
                                        toast(`Attached "${uv.name}" to ${c.name}`);
                                      } catch { toast("Failed to attach voice"); }
                                    }}
                                  >
                                    {c.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          onClick={async () => {
                            try {
                              await api.deleteUserVoice(uv.id);
                              setUserVoices((prev) => prev.filter((v) => v.id !== uv.id));
                              toast("Voice deleted");
                            } catch { toast("Failed to delete"); }
                          }}
                          className="size-9 rounded-md border border-border text-foreground-muted hover:text-danger hover:border-danger/40 flex items-center justify-center"
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}

                <button
                  onClick={() => { setShowAddVoiceModal(true); setAddVoiceTab("record"); setAddVoiceName(""); setAddVoiceRights("my_voice"); setAddVoiceRightsNote(""); setAddVoiceConfirmed(false); }}
                  className="rounded-xl border-2 border-dashed border-border-strong min-h-[260px] flex flex-col items-center justify-center gap-3 text-foreground-muted hover:border-accent hover:text-accent hover:bg-accent-soft/30 transition-all"
                >
                  <div className="size-12 rounded-full bg-surface border border-border flex items-center justify-center">
                    <Plus className="size-5" />
                  </div>
                  <div className="text-[13.5px] font-bold">Add a voice</div>
                </button>
              </div>
            </>
          )}

          {/* ── PROJECT VOICES TAB ─────────────────────── */}
          {voiceTab === "project" && !loading && !projectsLoading && activeProjectId && (
            <>
              <div className="mb-6">
                <h2 className="text-[22px] font-bold tracking-tight">Project voices</h2>
                <p className="text-[13.5px] text-foreground-muted mt-1">Voices currently attached to characters in this project.</p>
              </div>

              {characters.length === 0 ? (
                <EmptyState
                  icon={Mic2}
                  title="No characters in this project"
                  description="Add a character or import a video to get started."
                  action={
                    <div className="flex items-center gap-3">
                      <Link href="/characters" className="h-10 px-5 rounded-md text-sm font-semibold bg-foreground text-surface hover:bg-foreground/90 inline-flex items-center gap-2">
                        <Plus className="size-4" /> Add character
                      </Link>
                      <Link href="/upload-match" className="h-10 px-5 rounded-md text-sm font-semibold border border-border text-foreground hover:bg-canvas inline-flex items-center gap-2">
                        <Upload className="size-4" /> Import from video
                      </Link>
                    </div>
                  }
                />
              ) : (
                <>
                  {/* Characters table */}
                  <div className="bg-surface border border-border rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[2fr_2fr_1fr_auto] px-5 h-11 items-center border-b border-border bg-canvas">
                      <div className="label-eyebrow">Character</div>
                      <div className="label-eyebrow">Voice</div>
                      <div className="label-eyebrow">Source</div>
                      <div />
                    </div>
                    {characters.map((c) => {
                      const isActive = c.id === selectedId;
                      return (
                        <div
                          key={c.id}
                          className={`grid grid-cols-[2fr_2fr_1fr_auto] px-5 py-4 items-center border-b border-border-subtle last:border-b-0 cursor-pointer transition-colors ${
                            isActive ? "bg-accent-soft/20" : "hover:bg-canvas/50"
                          }`}
                          onClick={() => setSelectedId(c.id)}
                        >
                          <div className="flex items-center gap-3">
                            {characterAvatarSrc(c) ? (
                              <img src={characterAvatarSrc(c)!} alt={c.name} className="size-10 rounded-full object-cover" />
                            ) : (
                              <div className="size-10 rounded-full flex items-center justify-center text-[12px] font-bold bg-accent-soft text-accent">
                                {initials(c.name)}
                              </div>
                            )}
                            <div className="font-semibold text-[14px]">{c.name}</div>
                          </div>
                          <div>
                            {c.default_voice_id ? (
                              <div className="flex items-center gap-2.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setSelectedId(c.id); void handlePlayCharacterVoice(); }}
                                  disabled={playingVoice}
                                  className="size-8 rounded-full bg-canvas border border-border flex items-center justify-center hover:border-foreground-muted"
                                >
                                  <Play className="size-3 fill-foreground text-foreground ml-0.5" />
                                </button>
                                <div>
                                  <div className="text-[13px] font-semibold flex items-center gap-1.5">
                                    {c.voice_display_name || c.default_voice_id}
                                    <CheckCircle2 className="size-3.5 text-success" />
                                  </div>
                                  {c.voice_source_type && (
                                    <div className="text-[11px] text-foreground-subtle capitalize">{c.voice_source_type} voice</div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedId(c.id); setStudioSection("voice"); }}
                                className="text-[12.5px] font-semibold text-warning-foreground bg-warning-soft border border-warning-border px-3 py-1.5 rounded-md hover:bg-warning-soft/70 inline-flex items-center gap-1.5"
                              >
                                <Sparkles className="size-3.5" /> Attach voice
                              </button>
                            )}
                          </div>
                          <div className="text-[13px] text-foreground-muted capitalize">
                            {c.voice_source_type || (c.source_speaker_labels.length > 0 ? "Imported" : "Manual")}
                          </div>
                          <div className="flex items-center gap-1">
                            {c.default_voice_id && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedId(c.id); setStudioSection("voice"); }}
                                className="h-8 px-2.5 rounded-md text-[12px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas border border-border"
                              >
                                Change
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Selected character studio ────────── */}
                  {selected && (
                    <div className="mt-8 space-y-5">
                      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5">
                        {characterAvatarSrc(selected) ? (
                          <img src={characterAvatarSrc(selected)!} alt={selected.name} className="h-16 w-16 rounded-2xl object-cover ring-4 ring-accent/30" />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent ring-4 ring-accent/20">
                            {initials(selected.name)}
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h2 className="text-xl font-semibold tracking-tight">{selected.name}</h2>
                            {selected.voice_source_type && (
                              <Badge tone="accent">
                                {selected.voice_source_type === "catalog" ? "Catalog" : selected.voice_source_type === "designed" ? "Designed" : selected.voice_source_type === "remixed" ? "Remixed" : selected.voice_source_type}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-foreground-muted">
                            {selected.source_speaker_labels.length > 0 ? "Imported from video" : "Manual character"} · Voice:{" "}
                            <span className="font-medium text-foreground">{selected.voice_display_name || selected.default_voice_id || "Not assigned"}</span>
                          </p>
                        </div>
                        <Button variant="secondary" type="button" disabled={!selected.default_voice_id || playingVoice} onClick={() => void handlePlayCharacterVoice()} className="rounded-full px-3">
                          {playingVoice ? <Spinner className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        </Button>
                      </div>

                      {/* Studio section tabs */}
                      <div className="flex gap-1 rounded-lg border border-border bg-canvas p-1">
                        {([
                          { id: "voice" as const, label: "Voice", icon: Mic2 },
                          { id: "draft" as const, label: "Draft Lines", icon: Wand2 },
                          { id: "clips" as const, label: "Saved Clips", icon: Library },
                        ]).map(({ id, label, icon: Icon }) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setStudioSection(id)}
                            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                              studioSection === id ? "bg-surface text-foreground shadow-xs" : "text-foreground-muted hover:bg-surface/50"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* ── Voice setup ──────────────────── */}
                      {studioSection === "voice" && (
                        <div className="grid gap-5 md:grid-cols-2">
                          <div className="rounded-xl border border-border bg-surface p-5">
                            <div className="mb-4 flex items-center gap-2">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                                <Sparkles className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-semibold text-foreground">Design a new voice</p>
                                <p className="text-xs text-foreground-muted">Describe tone and style</p>
                              </div>
                            </div>
                            <textarea className="min-h-24 w-full resize-none rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" placeholder="Describe the target voice" value={designDesc} onChange={(e) => setDesignDesc(e.target.value)} />
                            <textarea className="mt-2 w-full resize-none rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" rows={3} placeholder="Preview line" value={designPreviewText} onChange={(e) => setDesignPreviewText(e.target.value)} />
                            <Button className="mt-4 w-full" disabled={designLoading || !designDesc.trim()} onClick={() => void handleDesignGenerate()}>
                              {designLoading ? <><Spinner className="h-4 w-4" /> Generating...</> : "Generate voice"}
                            </Button>
                            {designErr && <ErrorBanner title="Design" detail={designErr} />}
                            {designResult?.candidates?.length ? (
                              <div className="mt-4 space-y-2">
                                {designResult.candidates.map((c) => (
                                  <button key={c.generated_voice_id} type="button" className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${designPickGid === c.generated_voice_id ? "border-accent bg-accent-soft/30" : "border-border bg-canvas"}`} onClick={() => setDesignPickGid(c.generated_voice_id)}>
                                    <span className="font-medium">{c.label}</span>
                                    <audio controls className="mt-2 w-full" src={audioSrcFromApiPath(c.preview_audio_url)} />
                                  </button>
                                ))}
                                <input className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-border-strong" value={designVoiceName} onChange={(e) => setDesignVoiceName(e.target.value)} placeholder="Saved voice name" />
                                <Button className="w-full" disabled={designSaveLoading || !designPickGid || !designVoiceName.trim()} onClick={() => void handleDesignSave()}>
                                  {designSaveLoading ? <><Spinner className="h-4 w-4" /> Saving...</> : "Save selected voice"}
                                </Button>
                              </div>
                            ) : null}
                          </div>

                          <div className="rounded-xl border border-border bg-surface p-5">
                            <div className="mb-4 flex items-center gap-2">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                                <LayoutGrid className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-semibold text-foreground">Browse catalog</p>
                                <p className="text-xs text-foreground-muted">Pick a ready voice. Use the play button to preview.</p>
                              </div>
                            </div>
                            {voiceHub && (
                              <div className="mb-2 flex items-center gap-2 text-xs text-foreground-muted">
                                <Badge tone={voiceHub.source === "primary" ? "success" : "default"}>
                                  {voiceHub.source === "primary" ? "Primary library" : "Backup catalog"}
                                </Badge>
                                <span>{voiceHub.total} voices</span>
                              </div>
                            )}
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
                              <input type="search" className="w-full rounded-md border border-border bg-canvas py-2 pl-9 pr-3 text-sm outline-none focus:border-border-strong" placeholder="Search voices" value={voiceSearchInput} onChange={(e) => setVoiceSearchInput(e.target.value)} />
                            </div>
                            <button type="button" className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-accent/40 bg-accent-soft/20 py-2 text-xs font-semibold text-accent hover:bg-accent-soft/40" onClick={() => { setShowAddVoiceModal(true); setAddVoiceTab("record"); setAddVoiceName(""); setAddVoiceRights("my_voice"); setAddVoiceRightsNote(""); setAddVoiceConfirmed(false); }}>
                              <Plus className="h-3.5 w-3.5" /> Add my voice
                            </button>
                            <div className="mt-3 max-h-[320px] space-y-0 overflow-y-auto rounded-lg border border-border">
                              <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-3 py-1.5 label-eyebrow backdrop-blur">My saved voices</div>
                              {userVoices.length === 0 ? (
                                <p className="px-3 py-2 text-xs text-foreground-muted">Record or upload your first voice above.</p>
                              ) : userVoices.map((uv) => (
                                <div key={uv.id} className="group flex items-center gap-2 border-b border-border-subtle px-3 py-2 hover:bg-canvas/50">
                                  <div className="flex-1 min-w-0">
                                    <div className="truncate text-xs font-medium text-foreground">{uv.name}</div>
                                    <div className="text-[10px] text-foreground-muted capitalize">{uv.source_type}</div>
                                  </div>
                                  {uv.preview_url && (
                                    <button type="button" className="shrink-0 rounded-md p-1 text-foreground-muted hover:text-accent" onClick={() => playVoicePreview(audioSrcFromApiPath(uv.preview_url!))}>
                                      <Play className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {selectedId && uv.elevenlabs_voice_id && (
                                    <button
                                      type="button"
                                      className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent-soft/30"
                                      onClick={async () => {
                                        try {
                                          const updated = await api.patchCharacter(selectedId, {
                                            default_voice_id: uv.elevenlabs_voice_id!,
                                            voice_provider: "primary",
                                            voice_display_name: uv.name,
                                            voice_source_type: uv.source_type === "recorded" ? "recorded" : "uploaded",
                                          });
                                          setCharacters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
                                          toast(`Attached "${uv.name}" to ${characters.find(c => c.id === selectedId)?.name || "character"}`);
                                        } catch { toast("Failed to attach voice"); }
                                      }}
                                    >
                                      Attach
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="shrink-0 rounded-md p-1 text-foreground-muted opacity-0 group-hover:opacity-100 hover:text-danger"
                                    onClick={async () => {
                                      try {
                                        await api.deleteUserVoice(uv.id);
                                        setUserVoices((prev) => prev.filter((v) => v.id !== uv.id));
                                        toast("Voice deleted");
                                      } catch { toast("Failed to delete"); }
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                              {catalogLoading && <p className="px-3 py-2 text-xs text-foreground-muted">Loading voices...</p>}
                              {catalogError && <p className="px-3 py-2 text-xs text-danger">{catalogError}</p>}
                              {projectVoices.length > 0 && (
                                <>
                                  <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-3 py-1.5 label-eyebrow text-accent backdrop-blur">Project voices</div>
                                  {projectVoices.map((v) => {
                                    const active = chosenVoiceId === v.voice_id;
                                    const charName = characters.find((cx) => cx.default_voice_id === v.voice_id)?.name;
                                    return (
                                      <div key={v.voice_id} className={`flex w-full items-stretch border-b border-border-subtle last:border-b-0 ${active ? "bg-accent-soft/20 ring-1 ring-inset ring-accent/30" : ""}`}>
                                        <button type="button" className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm hover:bg-canvas/50" onClick={() => setChosenVoiceId(v.voice_id)}>
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-foreground">{v.display_name}</span>
                                            <span className="flex items-center gap-1">
                                              {charName && <Badge tone="default">{charName}</Badge>}
                                              {active && <Badge tone="accent">Selected</Badge>}
                                            </span>
                                          </div>
                                          {v.description && <p className="line-clamp-1 text-[11px] text-foreground-muted">{v.description}</p>}
                                        </button>
                                        <button type="button" disabled={!selected?.id || rowPreviewBusyId !== null} className="flex w-11 shrink-0 items-center justify-center border-l border-border text-foreground-muted hover:bg-canvas/50 hover:text-foreground disabled:opacity-40" onClick={(e) => { e.preventDefault(); void previewVoiceRow(v.voice_id); }}>
                                          {rowPreviewBusyId === v.voice_id ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </>
                              )}
                              {catalogVoices.length > 0 && (
                                <>
                                  <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-3 py-1.5 label-eyebrow text-foreground-subtle backdrop-blur">Catalog voices</div>
                                  {catalogVoices.map((v) => {
                                    const active = chosenVoiceId === v.voice_id;
                                    return (
                                      <div key={v.voice_id} className={`flex w-full items-stretch border-b border-border-subtle last:border-b-0 ${active ? "bg-accent-soft/20 ring-1 ring-inset ring-accent/30" : ""}`}>
                                        <button type="button" className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm hover:bg-canvas/50" onClick={() => setChosenVoiceId(v.voice_id)}>
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-foreground">{v.display_name}</span>
                                            {active && <Badge tone="accent">Selected</Badge>}
                                          </div>
                                          {v.description && <p className="line-clamp-2 text-[11px] text-foreground-muted">{v.description}</p>}
                                        </button>
                                        <button type="button" disabled={!selected?.id || rowPreviewBusyId !== null} className="flex w-11 shrink-0 items-center justify-center border-l border-border text-foreground-muted hover:bg-canvas/50 hover:text-foreground disabled:opacity-40" onClick={(e) => { e.preventDefault(); void previewVoiceRow(v.voice_id); }}>
                                          {rowPreviewBusyId === v.voice_id ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </>
                              )}
                            </div>
                            <Button className="mt-3 w-full" disabled={saving || !chosenVoiceId || !voiceHub} onClick={() => void handleAssignVoice()}>
                              {saving ? <><Spinner className="h-4 w-4" /> Saving...</> : "Save voice"}
                            </Button>
                            {saveSuccess && <p className="mt-2 text-xs text-success">Saved</p>}

                            <details className="mt-5 border-t border-border pt-4 group">
                              <summary className="label-eyebrow cursor-pointer select-none list-none flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
                                <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" />
                                Advanced: Remix voice
                              </summary>
                              <div className="mt-3">
                              {!remixEligible ? (
                                <p className="text-xs text-warning-foreground">Remix requires a designed or remixed base voice.</p>
                              ) : (
                                <>
                                  <textarea className="min-h-[72px] w-full resize-none rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" placeholder="How should this voice change?" value={remixPrompt} onChange={(e) => setRemixPrompt(e.target.value)} />
                                  <textarea className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" rows={3} placeholder="Preview line" value={remixPreviewText} onChange={(e) => setRemixPreviewText(e.target.value)} />
                                  <Button className="mt-2 w-full" disabled={remixLoading || !remixPrompt.trim() || !remixEligible} onClick={() => void handleRemixGenerate()}>
                                    {remixLoading ? <><Spinner className="h-4 w-4" /> Generating...</> : "Generate remix variants"}
                                  </Button>
                                  {remixErr && <ErrorBanner title="Remix" detail={remixErr} />}
                                  {remixResult?.candidates?.length ? (
                                    <div className="mt-3 space-y-2">
                                      {remixResult.candidates.map((c) => (
                                        <button key={c.generated_voice_id} type="button" className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${remixPickGid === c.generated_voice_id ? "border-accent bg-accent-soft/30" : "border-border bg-canvas"}`} onClick={() => setRemixPickGid(c.generated_voice_id)}>
                                          <span className="font-medium">{c.label}</span>
                                          <audio controls className="mt-2 w-full" src={audioSrcFromApiPath(c.preview_audio_url)} />
                                        </button>
                                      ))}
                                      <input className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-border-strong" value={remixVoiceName} onChange={(e) => setRemixVoiceName(e.target.value)} placeholder="Saved remix name" />
                                      <Button className="w-full" disabled={remixSaveLoading || !remixPickGid || !remixVoiceName.trim()} onClick={() => void handleRemixSave()}>
                                        {remixSaveLoading ? <><Spinner className="h-4 w-4" /> Saving...</> : "Save variant"}
                                      </Button>
                                    </div>
                                  ) : null}
                                </>
                              )}
                              </div>
                            </details>
                          </div>
                        </div>
                      )}

                      {/* ── Draft lines ──────────────────── */}
                      {studioSection === "draft" && (
                        <div className="rounded-xl border border-border bg-surface p-5">
                          <div className="mb-4">
                            <p className="text-base font-semibold text-foreground">Create draft lines</p>
                            <p className="text-sm text-foreground-muted">Describe the scene and generate lines for {selected.name}.</p>
                          </div>
                          {!showDirectTextAdvanced ? (
                            <>
                              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Scene / plot prompt</label>
                              <textarea className="min-h-32 w-full resize-none rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" value={promptInput} onChange={(e) => { setPromptInput(e.target.value); setPreviewError(null); }} placeholder="What is happening in the scene?" maxLength={SCENE_PROMPT_MAX_CHARS} />
                              <div className="mt-2 flex items-center justify-between text-xs text-foreground-muted">
                                <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => setShowDirectTextAdvanced(true)}>Use direct text instead</button>
                                <span>{promptInput.length}/{SCENE_PROMPT_MAX_CHARS}</span>
                              </div>
                              <Button className="mt-4 w-full" onClick={() => void handleGenerateLinesFromPrompt()} disabled={promptLinesBusy || !promptInput.trim() || promptInput.trim().length > SCENE_PROMPT_MAX_CHARS}>
                                {promptLinesBusy ? <><Spinner className="h-4 w-4" /> Generating draft lines...</> : "Generate draft lines"}
                              </Button>
                            </>
                          ) : (
                            <div className="space-y-3">
                              <button type="button" className="text-xs text-foreground-muted underline-offset-4 hover:text-foreground hover:underline" onClick={() => setShowDirectTextAdvanced(false)}>Back to scene prompt flow</button>
                              <div className="flex flex-wrap gap-2">
                                {(["single_line", "multi_line"] as const).map((m) => (
                                  <button key={m} type="button" className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${directInputMode === m ? "bg-accent-soft/30 text-foreground ring-1 ring-accent/35" : "bg-canvas text-foreground-muted hover:bg-canvas/70"}`} onClick={() => setDirectInputMode(m)}>
                                    {m === "single_line" ? "Single line" : "Multi-line"}
                                  </button>
                                ))}
                              </div>
                              {directInputMode === "single_line" ? (
                                <textarea className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" rows={3} placeholder="Text for one clip" value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
                              ) : (
                                <textarea className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" rows={5} placeholder="One line per clip" value={directLinesInput} onChange={(e) => setDirectLinesInput(e.target.value)} />
                              )}
                              <input className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-border-strong" placeholder="Clip label prefix (optional)" value={clipLabel} onChange={(e) => setClipLabel(e.target.value)} />
                              <Button className="w-full" onClick={() => void handleGenerateDirectClips()} disabled={generating || !selected.default_voice_id || (directInputMode === "single_line" ? !sampleText.trim() : !directLinesInput.trim())}>
                                {generating ? <><Spinner className="h-4 w-4" /> Generating...</> : "Generate audio clips"}
                              </Button>
                            </div>
                          )}

                          {promptLines.length > 0 && (
                            <div ref={reviewSectionRef} className="mt-5 space-y-3 rounded-xl border border-border bg-canvas p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold">Review lines</p>
                                <Button type="button" variant="ghost" onClick={() => setPromptLines((prev) => [...prev, { id: `manual-${Date.now()}`, text: "", tone_style: "" }])}>Add line</Button>
                              </div>
                              <ul className="space-y-2">
                                {promptLines.map((line) => (
                                  <li key={line.id} className="space-y-2 rounded-lg border border-border bg-surface p-3">
                                    <textarea className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-border-strong" rows={3} value={line.text} onChange={(e) => setPromptLines((prev) => prev.map((x) => x.id === line.id ? { ...x, text: e.target.value } : x))} />
                                    <div className="flex justify-end">
                                      <Button type="button" variant="ghost" onClick={() => setPromptLines((prev) => prev.filter((x) => x.id !== line.id))}>Remove</Button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                              <Button className="w-full" onClick={() => void handleGeneratePromptClips()} disabled={generating || !selected.default_voice_id || promptLines.filter((x) => x.text.trim()).length === 0}>
                                {generating ? <><Spinner className="h-4 w-4" /> Generating...</> : "Approve and generate audio"}
                              </Button>
                            </div>
                          )}

                          {previewError && <ErrorBanner title="Generation failed" detail={previewError} />}
                          {preview && (
                            <div className="mt-4 rounded-xl border border-border bg-canvas p-4">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold">Latest preview</p>
                                <Badge tone={preview.provider === "primary" ? "success" : "default"}>
                                  {preview.provider === "fallback" ? "On-device voice engine" : "Standard voice engine"}
                                </Badge>
                              </div>
                              <p className="mt-2 text-xs italic text-foreground-muted">&ldquo;{preview.text}&rdquo;</p>
                              <audio controls className="mt-3 w-full" src={mediaUrl(preview.audio_url.replace(/^\/media\//, ""))} />
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Saved clips ──────────────────── */}
                      {studioSection === "clips" && (
                        <div ref={clipsSectionRef}>
                          <div className={`rounded-xl border bg-surface p-5 ${activeStep === "clips" ? "border-accent/35" : "border-border"}`}>
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-base font-semibold">Saved clips</p>
                                <p className="text-sm text-foreground-muted">Clips for {selected.name}</p>
                              </div>
                              {clips.length > 0 && (
                                <a href={api.characterClipsZipUrl(selected.id)} className="inline-flex items-center gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-xs font-medium text-foreground hover:bg-canvas/80">
                                  <Download className="h-3.5 w-3.5" /> Download all
                                </a>
                              )}
                            </div>
                            {clipsLoading ? (
                              <p className="text-xs text-foreground-muted">Loading clips...</p>
                            ) : clips.length === 0 ? (
                              <p className="text-xs text-foreground-muted">No clips yet. Generate audio in Draft Lines.</p>
                            ) : (
                              <ul className="space-y-2.5">
                                {clips.map((cl) => (
                                  <li key={cl.id} className={`rounded-xl border p-3 transition ${freshClipIds.has(cl.id) ? "border-success/50 bg-success-soft/20" : "border-border hover:border-accent/35"}`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <input key={`${cl.id}-${cl.title}`} className="w-full rounded border border-border bg-canvas px-2 py-1 text-xs text-foreground outline-none focus:border-border-strong" defaultValue={cl.title} disabled={clipBusyId === cl.id} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cl.title) void handleRenameClip(cl, v); }} />
                                      {freshClipIds.has(cl.id) && <Badge tone="success">New</Badge>}
                                    </div>
                                    <p className="mt-2 text-xs text-foreground-muted whitespace-pre-wrap">{cl.text}</p>
                                    <audio controls className="mt-2 h-9 w-full" src={mediaUrl(cl.audio_url.replace(/^\/media\//, ""))} />
                                    <div className="mt-2 flex gap-3 text-[11px]">
                                      <a href={mediaUrl(cl.audio_url.replace(/^\/media\//, ""))} download className="font-medium text-accent hover:underline">Download</a>
                                      <button type="button" className="inline-flex items-center gap-1 font-medium text-danger hover:underline disabled:opacity-50" disabled={clipBusyId === cl.id} onClick={() => void handleDeleteClip(cl.id)}>
                                        <Trash2 className="h-3 w-3" /> Delete
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>

      {/* ── Modals ────────────────────────────────────── */}
      <ConfirmModal
        open={!!confirmDeleteClipId}
        title="Delete clip"
        confirmLabel="Delete clip"
        danger
        busy={clipBusyId === confirmDeleteClipId}
        onConfirm={() => void executeDeleteClip()}
        onCancel={() => setConfirmDeleteClipId(null)}
      >
        <p>Delete this clip from your library?</p>
      </ConfirmModal>

      {showAddVoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm" onClick={() => setShowAddVoiceModal(false)}>
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-[20px] font-bold tracking-tight">Add a voice</h3>
              <button type="button" className="text-foreground-muted hover:text-foreground p-1 -mt-1 -mr-1" onClick={() => setShowAddVoiceModal(false)}>
                <X className="size-5" />
              </button>
            </div>
            <p className="text-[13.5px] text-foreground-muted mb-5">Choose how you want to bring a new voice into your library.</p>

            <div className="flex gap-2">
              <button type="button" className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${addVoiceTab === "record" ? "bg-foreground text-surface" : "bg-canvas text-foreground-muted hover:text-foreground"}`} onClick={() => setAddVoiceTab("record")}>
                <Mic2 className="mr-1.5 inline h-4 w-4" /> Record
              </button>
              <button type="button" className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${addVoiceTab === "upload" ? "bg-foreground text-surface" : "bg-canvas text-foreground-muted hover:text-foreground"}`} onClick={() => setAddVoiceTab("upload")}>
                <Upload className="mr-1.5 inline h-4 w-4" /> Upload
              </button>
            </div>

            <label className="mt-4 block text-xs font-semibold text-foreground">
              Voice name
              <input type="text" className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong" placeholder="e.g. My narrator voice" value={addVoiceName} onChange={(e) => setAddVoiceName(e.target.value)} />
            </label>

            <fieldset className="mt-4 space-y-2">
              <legend className="text-xs font-semibold text-foreground">Rights</legend>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="radio" name="voice-rights" value="my_voice" checked={addVoiceRights === "my_voice"} onChange={() => setAddVoiceRights("my_voice")} />
                This is my voice
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="radio" name="voice-rights" value="have_permission" checked={addVoiceRights === "have_permission"} onChange={() => setAddVoiceRights("have_permission")} />
                I have permission to use this voice
              </label>
              {addVoiceRights === "have_permission" && (
                <input type="text" className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs outline-none" placeholder="Optional: notes on permission" value={addVoiceRightsNote} onChange={(e) => setAddVoiceRightsNote(e.target.value)} />
              )}
            </fieldset>

            <label className="mt-4 flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={addVoiceConfirmed} onChange={(e) => setAddVoiceConfirmed(e.target.checked)} />
              I confirm I have the right to use this voice
            </label>

            <div className="mt-4">
              {addVoiceTab === "record" ? (
                <VoiceRecorder
                  onSave={async (blob) => {
                    if (!addVoiceConfirmed) { toast("Please confirm rights first"); return; }
                    const result = await api.recordUserVoice(blob, addVoiceName || "My recorded voice", addVoiceRights, addVoiceRightsNote);
                    setUserVoices((prev) => [result, ...prev]);
                    setShowAddVoiceModal(false);
                    toast(`Voice "${result.name}" saved`);
                    void trackUsage("voice_uploads");
                  }}
                />
              ) : (
                <VoiceUploader
                  onSave={async (file) => {
                    if (!addVoiceConfirmed) { toast("Please confirm rights first"); return; }
                    const result = await api.uploadUserVoice(file, addVoiceName || "My uploaded voice", addVoiceRights, addVoiceRightsNote);
                    setUserVoices((prev) => [result, ...prev]);
                    setShowAddVoiceModal(false);
                    toast(`Voice "${result.name}" saved`);
                    void trackUsage("voice_uploads");
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VoiceStudioPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 px-4 py-10">
          <Skeleton className="h-12 w-full max-w-xl" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <VoiceStudioContent />
    </Suspense>
  );
}
