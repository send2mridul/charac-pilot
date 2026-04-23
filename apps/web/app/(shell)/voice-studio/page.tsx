"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
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
} from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  DesignVoiceResponseDto,
  PreviewDto,
  RemixVoiceResponseDto,
  VoiceCatalogResponse,
  VoiceClipDto,
} from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { playVoicePreview, stopVoicePreview } from "@/lib/audio/voicePreviewPlayer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/buttonStyles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
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

/** Keep in sync with apps/api/schemas/character.py PROMPT_MAX_CHARS */
const SCENE_PROMPT_MAX_CHARS = 600;

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
  const [designResult, setDesignResult] = useState<DesignVoiceResponseDto | null>(
    null,
  );
  const [designPickGid, setDesignPickGid] = useState<string | null>(null);
  const [designErr, setDesignErr] = useState<string | null>(null);
  const [designSaveLoading, setDesignSaveLoading] = useState(false);

  const [remixPrompt, setRemixPrompt] = useState("");
  const [remixPreviewText, setRemixPreviewText] = useState("");
  const [remixVoiceName, setRemixVoiceName] = useState("Remixed voice");
  const [remixLoading, setRemixLoading] = useState(false);
  const [remixResult, setRemixResult] = useState<RemixVoiceResponseDto | null>(
    null,
  );
  const [remixPickGid, setRemixPickGid] = useState<string | null>(null);
  const [remixErr, setRemixErr] = useState<string | null>(null);
  const [remixSaveLoading, setRemixSaveLoading] = useState(false);

  const [clips, setClips] = useState<VoiceClipDto[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [clipLabel, setClipLabel] = useState("");
  const [clipBusyId, setClipBusyId] = useState<string | null>(null);
  const [confirmDeleteClipId, setConfirmDeleteClipId] = useState<string | null>(null);
  const [directInputMode, setDirectInputMode] =
    useState<DirectInputMode>("single_line");
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

  const selected = characters.find((c) => c.id === selectedId) ?? null;

  const focusAttach =
    (searchParams.get("focus") || "").trim().toLowerCase() === "attach";

  const pageSubtitle = useMemo(() => {
    const ch = characters.find((c) => c.id === selectedId);
    if (focusAttach && ch && !ch.default_voice_id) {
      return `You're attaching a voice to ${ch.name}. Use Voice setup below—pick a catalog voice or design one. That unlocks clips and Replace Lines.`;
    }
    return "Project characters get voices here. After a voice is attached, generate clips—then use Replace Lines to swap dialogue.";
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
  const createdVoices = allVoices.filter((v) => !projectVoiceIds.has(v.voice_id) && (v.category === "cloned" || v.category === "generated"));
  const catalogVoices = allVoices.filter((v) => !projectVoiceIds.has(v.voice_id) && v.category !== "cloned" && v.category !== "generated");

  const remixEligible =
    !!selected?.default_voice_id &&
    (selected.voice_source_type === "designed" ||
      selected.voice_source_type === "remixed");

  function handleVoiceStudioProjectChange(id: string) {
    if (!id || id === activeProjectId) return;
    setActiveProjectId(id);
    router.replace("/voice-studio");
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
    } catch (e) {
      setRemixErr(
        e instanceof ApiError ? e.message : "Could not save remixed voice",
      );
    } finally {
      setRemixSaveLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Voice Studio" subtitle={pageSubtitle} />

      <Panel className="border border-white/[0.08] bg-white/[0.04] shadow-[0_8px_24px_-18px_rgba(0,0,0,0.28)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Project
          </span>
          <div className="relative">
            <select
              className="flex cursor-pointer appearance-none items-center gap-2 rounded-lg border border-white/[0.12] bg-canvas/80 py-2 pl-3 pr-9 text-sm font-semibold text-text outline-none transition-colors hover:border-accent/40 focus:border-accent/40"
              value={activeProjectId ?? ""}
              disabled={projectsLoading || projects.length === 0}
              onChange={(e) => handleVoiceStudioProjectChange(e.target.value)}
            >
              {projects.length === 0 ? (
                <option value="">No projects</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
              <ChevronDown className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </Panel>

      {error ? <ErrorBanner title="Voice studio" detail={error} /> : null}

      {focusAttach &&
      selected &&
      !selected.default_voice_id &&
      !loading &&
      !projectsLoading &&
      characters.length > 0 ? (
        <Panel className="border border-accent/35 bg-accent/5">
          <p className="text-sm font-semibold text-text">
            Next step: assign or design a voice for {selected.name}
          </p>
          <p className="mt-1 text-xs text-muted">
            This character is selected. Scroll to Voice setup, choose a voice,
            and save, then you can generate clips or head to Replace Lines.
          </p>
        </Panel>
      ) : null}

      {projectsLoading ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i}>
              <Skeleton className="h-24 w-full" />
            </Panel>
          ))}
        </div>
      ) : !activeProjectId ? (
        <EmptyState
          icon={Mic2}
          title="Pick a project"
          description="Create a project first, then choose it in the Project menu above."
        />
      ) : loading ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i}>
              <Skeleton className="h-24 w-full" />
            </Panel>
          ))}
        </div>
      ) : characters.length === 0 ? (
        <EmptyState
          icon={Mic2}
          title="No characters in this project yet"
          description="Add a character manually or import a video to create characters from detected speakers."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/characters"
                className={buttonClass(
                  "primary",
                  "min-h-10 px-5 shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset]",
                )}
              >
                <Plus className="h-4 w-4" />
                Add character
              </Link>
              <Link
                href="/upload-match"
                className={buttonClass(
                  "secondary",
                  "min-h-10 border border-white/[0.12] bg-white/[0.04] px-5 text-text ring-white/[0.08] hover:bg-white/[0.07]",
                )}
              >
                <Upload className="h-4 w-4" />
                Import from Video
              </Link>
            </div>
          }
        />
      ) : (
        <div className="space-y-6">
          <Panel className="border border-white/[0.08] bg-white/[0.04] shadow-[0_8px_24px_-18px_rgba(0,0,0,0.28)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-text">Select character</p>
                <p className="text-xs text-muted">{characters.length} characters in this project</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {characters.map((c) => {
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-4 text-sm transition-all ${
                      active
                        ? "border-accent/60 bg-accent/20 text-text shadow-[0_8px_18px_-14px_rgba(34,197,181,0.6)]"
                        : "border-white/[0.12] bg-white/[0.03] text-muted hover:border-accent/40 hover:bg-white/[0.06]"
                    }`}
                  >
                    {characterAvatarSrc(c) ? (
                      <img
                        src={characterAvatarSrc(c) ?? ""}
                        alt={c.name}
                        className="h-7 w-7 rounded-full object-cover ring-2 ring-white/[0.7]"
                      />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] ring-2 ring-white/[0.7] text-[10px] font-semibold text-text">
                        {initials(c.name)}
                      </div>
                    )}
                    <span className="font-medium">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </Panel>

          {!selected ? (
            <Panel>
              <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                <Volume2 className="h-10 w-10 text-muted" />
                <p className="mt-4 text-sm text-muted">Select a character to continue.</p>
              </div>
            </Panel>
          ) : (
            <>
              <Panel className="border border-white/[0.08] bg-white/[0.04] shadow-[0_8px_24px_-18px_rgba(0,0,0,0.28)]">
                <div className="flex items-center gap-4">
                  {characterAvatarSrc(selected) ? (
                    <img
                      src={characterAvatarSrc(selected) ?? ""}
                      alt={selected.name}
                      className="h-16 w-16 rounded-2xl object-cover ring-4 ring-accent/30"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.08] ring-4 ring-accent/20 text-lg font-semibold text-text">
                      {initials(selected.name)}
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold tracking-tight text-text">{selected.name}</h2>
                      {selected.voice_source_type ? (
                        <Badge tone="accent">
                          {selected.voice_source_type === "catalog"
                            ? "Catalog"
                            : selected.voice_source_type === "designed"
                              ? "Designed"
                              : selected.voice_source_type === "remixed"
                                ? "Remixed"
                                : selected.voice_source_type}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted">
                      {selected.source_speaker_labels.length > 0 ? "Imported from video" : "Manual character"} • Voice:{" "}
                      <span className="font-medium text-text">
                        {selected.voice_display_name || selected.default_voice_id || "Not assigned"}
                      </span>
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={!selected.default_voice_id || playingVoice}
                    onClick={() => void handlePlayCharacterVoice()}
                    className="rounded-full px-3"
                    aria-label="Play character voice"
                    title="Play character voice"
                  >
                    {playingVoice ? (
                      <Spinner className="h-4 w-4 border-t-text" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </Panel>

              <Panel className="border border-white/[0.08] bg-white/[0.02] p-1">
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: "voice", label: "Voice", icon: Mic2 },
                      { id: "draft", label: "Draft Lines", icon: Wand2 },
                      { id: "clips", label: "Saved Clips", icon: Library },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setStudioSection(id)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                        studioSection === id
                          ? "bg-white text-text shadow-sm"
                          : "text-muted hover:bg-white/[0.04]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </Panel>

              {studioSection === "voice" ? (
                <div className="grid gap-5 md:grid-cols-2">
                  <Panel className="border border-white/[0.08] bg-white/[0.04]">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-text">Design a new voice</p>
                        <p className="text-xs text-muted">Describe tone and style</p>
                      </div>
                    </div>
                    <textarea
                      className="min-h-24 w-full resize-none rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                      placeholder="Describe the target voice"
                      value={designDesc}
                      onChange={(e) => setDesignDesc(e.target.value)}
                    />
                    <textarea
                      className="mt-2 w-full resize-none rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                      rows={3}
                      placeholder="Preview line"
                      value={designPreviewText}
                      onChange={(e) => setDesignPreviewText(e.target.value)}
                    />
                    <Button
                      className="mt-4 w-full"
                      disabled={designLoading || !designDesc.trim()}
                      onClick={() => void handleDesignGenerate()}
                    >
                      {designLoading ? (
                        <>
                          <Spinner className="h-4 w-4 border-t-canvas" />
                          Generating…
                        </>
                      ) : (
                        "Generate voice"
                      )}
                    </Button>
                    {designErr ? <ErrorBanner title="Design" detail={designErr} /> : null}
                    {designResult?.candidates?.length ? (
                      <div className="mt-4 space-y-2">
                        {designResult.candidates.map((c) => (
                          <button
                            key={c.generated_voice_id}
                            type="button"
                            className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                              designPickGid === c.generated_voice_id
                                ? "border-accent/60 bg-accent/10"
                                : "border-white/[0.12] bg-white/[0.02]"
                            }`}
                            onClick={() => setDesignPickGid(c.generated_voice_id)}
                          >
                            <span className="font-medium text-text">{c.label}</span>
                            <audio controls className="mt-2 w-full" src={audioSrcFromApiPath(c.preview_audio_url)} />
                          </button>
                        ))}
                        <input
                          className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                          value={designVoiceName}
                          onChange={(e) => setDesignVoiceName(e.target.value)}
                          placeholder="Saved voice name"
                        />
                        <Button
                          className="w-full"
                          disabled={designSaveLoading || !designPickGid || !designVoiceName.trim()}
                          onClick={() => void handleDesignSave()}
                        >
                          {designSaveLoading ? (
                            <>
                              <Spinner className="h-4 w-4 border-t-canvas" />
                              Saving…
                            </>
                          ) : (
                            "Save selected voice"
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </Panel>

                  <Panel className="border border-white/[0.08] bg-white/[0.04]">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
                        <LayoutGrid className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-text">Browse catalog</p>
                        <p className="text-xs text-muted">
                          Pick a ready voice. Use the play button to preview without saving.
                        </p>
                      </div>
                    </div>
                    {voiceHub ? (
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                        <Badge tone={voiceHub.source === "primary" ? "success" : "default"}>
                          {voiceHub.source === "primary" ? "Primary library" : "Backup catalog"}
                        </Badge>
                        <span>{voiceHub.total} voices</span>
                      </div>
                    ) : null}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <input
                        type="search"
                        className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 py-2 pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent/40"
                        placeholder="Search voices"
                        value={voiceSearchInput}
                        onChange={(e) => setVoiceSearchInput(e.target.value)}
                      />
                    </div>
                    <div className="mt-3 max-h-[320px] space-y-0 overflow-y-auto rounded-lg border border-white/[0.08]">
                      {catalogLoading ? (
                        <p className="px-3 py-2 text-xs text-muted">Loading voices...</p>
                      ) : null}
                      {catalogError ? (
                        <p className="px-3 py-2 text-xs text-red-300">{catalogError}</p>
                      ) : null}
                      {projectVoices.length > 0 ? (
                        <>
                          <div className="sticky top-0 z-10 border-b border-white/[0.08] bg-card/95 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-accent backdrop-blur">Project voices</div>
                          {projectVoices.map((v) => {
                            const active = chosenVoiceId === v.voice_id;
                            const charName = characters.find((c) => c.default_voice_id === v.voice_id)?.name;
                            return (
                              <div
                                key={v.voice_id}
                                className={`flex w-full items-stretch border-b border-white/[0.05] last:border-b-0 ${
                                  active ? "bg-accent/12 ring-1 ring-inset ring-accent/30" : ""
                                }`}
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm hover:bg-white/[0.03]"
                                  onClick={() => setChosenVoiceId(v.voice_id)}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-text">{v.display_name}</span>
                                    <span className="flex items-center gap-1">
                                      {charName ? <Badge tone="default">{charName}</Badge> : null}
                                      {active ? <Badge tone="accent">Selected</Badge> : null}
                                    </span>
                                  </div>
                                  {v.description ? (
                                    <p className="line-clamp-1 text-[11px] text-muted">{v.description}</p>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  disabled={!selected?.id || rowPreviewBusyId !== null}
                                  className="flex w-11 shrink-0 items-center justify-center border-l border-white/[0.06] text-muted hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
                                  aria-label={`Preview ${v.display_name}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void previewVoiceRow(v.voice_id);
                                  }}
                                >
                                  {rowPreviewBusyId === v.voice_id ? (
                                    <Spinner className="h-4 w-4 border-t-accent" />
                                  ) : (
                                    <Play className="h-4 w-4 fill-current" />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </>
                      ) : null}
                      {createdVoices.length > 0 ? (
                        <>
                          <div className="sticky top-0 z-10 border-b border-white/[0.08] bg-card/95 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 backdrop-blur">My created voices</div>
                          {createdVoices.map((v) => {
                            const active = chosenVoiceId === v.voice_id;
                            return (
                              <div
                                key={v.voice_id}
                                className={`flex w-full items-stretch border-b border-white/[0.05] last:border-b-0 ${
                                  active ? "bg-accent/12 ring-1 ring-inset ring-accent/30" : ""
                                }`}
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm hover:bg-white/[0.03]"
                                  onClick={() => setChosenVoiceId(v.voice_id)}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-text">{v.display_name}</span>
                                    {active ? <Badge tone="accent">Selected</Badge> : null}
                                  </div>
                                  {v.description ? (
                                    <p className="line-clamp-1 text-[11px] text-muted">{v.description}</p>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  disabled={!selected?.id || rowPreviewBusyId !== null}
                                  className="flex w-11 shrink-0 items-center justify-center border-l border-white/[0.06] text-muted hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
                                  aria-label={`Preview ${v.display_name}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void previewVoiceRow(v.voice_id);
                                  }}
                                >
                                  {rowPreviewBusyId === v.voice_id ? (
                                    <Spinner className="h-4 w-4 border-t-accent" />
                                  ) : (
                                    <Play className="h-4 w-4 fill-current" />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </>
                      ) : null}
                      {catalogVoices.length > 0 ? (
                        <>
                          <div className="sticky top-0 z-10 border-b border-white/[0.08] bg-card/95 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted backdrop-blur">Catalog voices</div>
                          {catalogVoices.map((v) => {
                            const active = chosenVoiceId === v.voice_id;
                            return (
                              <div
                                key={v.voice_id}
                                className={`flex w-full items-stretch border-b border-white/[0.05] last:border-b-0 ${
                                  active ? "bg-accent/12 ring-1 ring-inset ring-accent/30" : ""
                                }`}
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm hover:bg-white/[0.03]"
                                  onClick={() => setChosenVoiceId(v.voice_id)}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-text">{v.display_name}</span>
                                    {active ? <Badge tone="accent">Selected</Badge> : null}
                                  </div>
                                  {v.description ? (
                                    <p className="line-clamp-2 text-[11px] text-muted">{v.description}</p>
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  disabled={!selected?.id || rowPreviewBusyId !== null}
                                  className="flex w-11 shrink-0 items-center justify-center border-l border-white/[0.06] text-muted hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
                                  aria-label={`Preview ${v.display_name}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void previewVoiceRow(v.voice_id);
                                  }}
                                >
                                  {rowPreviewBusyId === v.voice_id ? (
                                    <Spinner className="h-4 w-4 border-t-accent" />
                                  ) : (
                                    <Play className="h-4 w-4 fill-current" />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </>
                      ) : null}
                    </div>
                    <Button
                      className="mt-3 w-full"
                      disabled={saving || !chosenVoiceId || !voiceHub}
                      onClick={() => void handleAssignVoice()}
                    >
                      {saving ? (
                        <>
                          <Spinner className="h-4 w-4 border-t-canvas" />
                          Saving…
                        </>
                      ) : (
                        "Save voice"
                      )}
                    </Button>
                    {saveSuccess ? <p className="mt-2 text-xs text-emerald-300">Saved</p> : null}
                    <div className="mt-5 border-t border-white/[0.08] pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Remix</p>
                      {!remixEligible ? (
                        <p className="mt-2 text-xs text-amber-300/90">Remix requires a designed or remixed base voice.</p>
                      ) : (
                        <>
                          <textarea
                            className="mt-2 min-h-[72px] w-full resize-none rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                            placeholder="How should this voice change?"
                            value={remixPrompt}
                            onChange={(e) => setRemixPrompt(e.target.value)}
                          />
                          <textarea
                            className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                            rows={3}
                            placeholder="Preview line"
                            value={remixPreviewText}
                            onChange={(e) => setRemixPreviewText(e.target.value)}
                          />
                          <Button
                            className="mt-2 w-full"
                            disabled={remixLoading || !remixPrompt.trim() || !remixEligible}
                            onClick={() => void handleRemixGenerate()}
                          >
                            {remixLoading ? (
                              <>
                                <Spinner className="h-4 w-4 border-t-canvas" />
                                Generating…
                              </>
                            ) : (
                              "Generate remix variants"
                            )}
                          </Button>
                          {remixErr ? <ErrorBanner title="Remix" detail={remixErr} /> : null}
                          {remixResult?.candidates?.length ? (
                            <div className="mt-3 space-y-2">
                              {remixResult.candidates.map((c) => (
                                <button
                                  key={c.generated_voice_id}
                                  type="button"
                                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                                    remixPickGid === c.generated_voice_id
                                      ? "border-accent/60 bg-accent/10"
                                      : "border-white/[0.12] bg-white/[0.02]"
                                  }`}
                                  onClick={() => setRemixPickGid(c.generated_voice_id)}
                                >
                                  <span className="font-medium text-text">{c.label}</span>
                                  <audio controls className="mt-2 w-full" src={audioSrcFromApiPath(c.preview_audio_url)} />
                                </button>
                              ))}
                              <input
                                className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                                value={remixVoiceName}
                                onChange={(e) => setRemixVoiceName(e.target.value)}
                                placeholder="Saved remix name"
                              />
                              <Button
                                className="w-full"
                                disabled={remixSaveLoading || !remixPickGid || !remixVoiceName.trim()}
                                onClick={() => void handleRemixSave()}
                              >
                                {remixSaveLoading ? (
                                  <>
                                    <Spinner className="h-4 w-4 border-t-canvas" />
                                    Saving…
                                  </>
                                ) : (
                                  "Save variant"
                                )}
                              </Button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </Panel>
                </div>
              ) : null}

              {studioSection === "draft" ? (
                <Panel className="border border-white/[0.08] bg-white/[0.04]">
                  <div className="mb-4">
                    <p className="text-base font-semibold text-text">Create draft lines</p>
                    <p className="text-sm text-muted">Describe the scene and generate lines for {selected.name}.</p>
                  </div>
                  {!showDirectTextAdvanced ? (
                    <>
                      <label className="mb-1.5 block text-xs font-medium text-muted">Scene / plot prompt</label>
                      <textarea
                        className="min-h-32 w-full resize-none rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                        value={promptInput}
                        onChange={(e) => {
                          setPromptInput(e.target.value);
                          setPreviewError(null);
                        }}
                        placeholder="What is happening in the scene?"
                        maxLength={SCENE_PROMPT_MAX_CHARS}
                      />
                      <div className="mt-2 flex items-center justify-between text-xs text-muted">
                        <button
                          type="button"
                          className="underline-offset-4 hover:text-text hover:underline"
                          onClick={() => setShowDirectTextAdvanced(true)}
                        >
                          Use direct text instead
                        </button>
                        <span>{promptInput.length}/{SCENE_PROMPT_MAX_CHARS}</span>
                      </div>
                      <Button
                        className="mt-4 w-full"
                        onClick={() => void handleGenerateLinesFromPrompt()}
                        disabled={
                          promptLinesBusy ||
                          !promptInput.trim() ||
                          promptInput.trim().length > SCENE_PROMPT_MAX_CHARS
                        }
                      >
                        {promptLinesBusy ? (
                          <>
                            <Spinner className="h-4 w-4 border-t-canvas" />
                            Generating draft lines…
                          </>
                        ) : (
                          "Generate draft lines"
                        )}
                      </Button>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <button
                        type="button"
                        className="text-xs text-muted underline-offset-4 hover:text-text hover:underline"
                        onClick={() => setShowDirectTextAdvanced(false)}
                      >
                        Back to scene prompt flow
                      </button>
                      <div className="flex flex-wrap gap-2">
                        {(["single_line", "multi_line"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                              directInputMode === m
                                ? "bg-accent/20 text-text ring-1 ring-accent/35"
                                : "bg-white/[0.04] text-muted hover:bg-white/[0.07]"
                            }`}
                            onClick={() => setDirectInputMode(m)}
                          >
                            {m === "single_line" ? "Single line" : "Multi-line"}
                          </button>
                        ))}
                      </div>
                      {directInputMode === "single_line" ? (
                        <textarea
                          className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                          rows={3}
                          placeholder="Text for one clip"
                          value={sampleText}
                          onChange={(e) => setSampleText(e.target.value)}
                        />
                      ) : (
                        <textarea
                          className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                          rows={5}
                          placeholder="One line per clip"
                          value={directLinesInput}
                          onChange={(e) => setDirectLinesInput(e.target.value)}
                        />
                      )}
                      <input
                        className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                        placeholder="Clip label prefix (optional)"
                        value={clipLabel}
                        onChange={(e) => setClipLabel(e.target.value)}
                      />
                      <Button
                        className="w-full"
                        onClick={() => void handleGenerateDirectClips()}
                        disabled={
                          generating ||
                          !selected.default_voice_id ||
                          (directInputMode === "single_line"
                            ? !sampleText.trim()
                            : !directLinesInput.trim())
                        }
                      >
                        {generating ? (
                          <>
                            <Spinner className="h-4 w-4 border-t-canvas" />
                            Generating…
                          </>
                        ) : (
                          "Generate audio clips"
                        )}
                      </Button>
                    </div>
                  )}

                  {promptLines.length > 0 ? (
                    <div ref={reviewSectionRef} className="mt-5 space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-text">Review lines</p>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setPromptLines((prev) => [
                              ...prev,
                              { id: `manual-${Date.now()}`, text: "", tone_style: "" },
                            ])
                          }
                        >
                          Add line
                        </Button>
                      </div>
                      <ul className="space-y-2">
                        {promptLines.map((line) => (
                          <li key={line.id} className="space-y-2 rounded-lg border border-white/[0.1] bg-white/[0.02] p-3">
                            <textarea
                              className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                              rows={3}
                              value={line.text}
                              onChange={(e) =>
                                setPromptLines((prev) =>
                                  prev.map((x) => (x.id === line.id ? { ...x, text: e.target.value } : x)),
                                )
                              }
                            />
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setPromptLines((prev) => prev.filter((x) => x.id !== line.id))}
                              >
                                Remove
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <Button
                        className="w-full"
                        onClick={() => void handleGeneratePromptClips()}
                        disabled={
                          generating ||
                          !selected.default_voice_id ||
                          promptLines.filter((x) => x.text.trim()).length === 0
                        }
                      >
                        {generating ? (
                          <>
                            <Spinner className="h-4 w-4 border-t-canvas" />
                            Generating…
                          </>
                        ) : (
                          "Approve and generate audio"
                        )}
                      </Button>
                    </div>
                  ) : null}

                  {previewError ? <ErrorBanner title="Generation failed" detail={previewError} /> : null}
                  {preview ? (
                    <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-text">Latest preview</p>
                        <Badge tone={preview.provider === "primary" ? "success" : "default"}>
                          {preview.provider === "fallback"
                            ? "On-device voice engine"
                            : "Standard voice engine"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs italic text-muted">&ldquo;{preview.text}&rdquo;</p>
                      <audio controls className="mt-3 w-full" src={mediaUrl(preview.audio_url.replace(/^\/media\//, ""))} />
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {studioSection === "clips" ? (
                <div ref={clipsSectionRef}>
                  <Panel className={activeStep === "clips" ? "ring-accent/35" : undefined}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-text">Saved clips</p>
                        <p className="text-sm text-muted">Clips for {selected.name}</p>
                      </div>
                      {clips.length > 0 ? (
                        <a
                          href={api.characterClipsZipUrl(selected.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-xs font-medium text-text hover:bg-white/[0.06]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download all
                        </a>
                      ) : null}
                    </div>
                    {clipsLoading ? (
                      <p className="text-xs text-muted">Loading clips…</p>
                    ) : clips.length === 0 ? (
                      <p className="text-xs text-muted">No clips yet. Generate audio in Draft Lines.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {clips.map((cl) => (
                          <li
                            key={cl.id}
                            className={`rounded-xl border bg-white/[0.02] p-3 transition ${
                              freshClipIds.has(cl.id)
                                ? "border-emerald-300/50 bg-emerald-500/10"
                                : "border-white/[0.1] hover:border-accent/35"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <input
                                key={`${cl.id}-${cl.title}`}
                                className="w-full rounded border border-white/[0.1] bg-canvas/80 px-2 py-1 text-xs text-text outline-none focus:border-accent/40"
                                defaultValue={cl.title}
                                disabled={clipBusyId === cl.id}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v && v !== cl.title) void handleRenameClip(cl, v);
                                }}
                              />
                              {freshClipIds.has(cl.id) ? <Badge tone="success">New</Badge> : null}
                            </div>
                            <p className="mt-2 text-xs text-muted whitespace-pre-wrap">{cl.text}</p>
                            <audio
                              controls
                              className="mt-2 h-9 w-full"
                              src={mediaUrl(cl.audio_url.replace(/^\/media\//, ""))}
                            />
                            <div className="mt-2 flex gap-3 text-[11px]">
                              <a
                                href={mediaUrl(cl.audio_url.replace(/^\/media\//, ""))}
                                download
                                className="font-medium text-accent hover:underline"
                              >
                                Download
                              </a>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 font-medium text-red-400/90 hover:underline disabled:opacity-50"
                                disabled={clipBusyId === cl.id}
                                onClick={() => void handleDeleteClip(cl.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

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
