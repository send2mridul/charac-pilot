"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Download,
  LayoutGrid,
  Library,
  Mic2,
  Play,
  Search,
  Sparkles,
  Trash2,
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
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";

type StudioTab = "browse" | "design" | "remix";
type DirectInputMode = "single_line" | "multi_line";
type ReviewLine = {
  id: string;
  text: string;
  tone_style: string;
};

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
  const { activeProjectId } = useProjects();
  const searchParams = useSearchParams();
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [voiceHub, setVoiceHub] = useState<VoiceCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [voiceSearchInput, setVoiceSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosenVoiceId, setChosenVoiceId] = useState<string>("");
  const [sampleText, setSampleText] = useState("");
  const [styleInput, setStyleInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<PreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [tab, setTab] = useState<StudioTab>("browse");

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
  const [directInputMode, setDirectInputMode] =
    useState<DirectInputMode>("single_line");
  const [directLinesInput, setDirectLinesInput] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [promptLines, setPromptLines] = useState<ReviewLine[]>([]);
  const [promptLinesBusy, setPromptLinesBusy] = useState(false);
  const [showDirectTextAdvanced, setShowDirectTextAdvanced] = useState(false);
  const [editingVoice, setEditingVoice] = useState(false);
  const [showClipGenerator, setShowClipGenerator] = useState(true);

  useEffect(() => {
    const q = searchParams.get("character");
    if (q?.trim()) setSelectedId(q.trim());
  }, [searchParams]);

  useEffect(() => {
    if (!selectedId) return;
    const panel = (searchParams.get("panel") || "").trim().toLowerCase();
    const tabParam = (searchParams.get("tab") || "").trim().toLowerCase();

    if (panel === "voice") {
      setEditingVoice(true);
      setShowClipGenerator(false);
    } else if (panel === "clips") {
      setEditingVoice(false);
      setShowClipGenerator(true);
    }

    if (tabParam === "browse" || tabParam === "design" || tabParam === "remix") {
      setTab(tabParam as StudioTab);
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

  async function handleLoadMoreVoices() {
    if (!voiceHub?.has_more || loadMoreLoading) return;
    const nextPage = voiceHub.page + 1;
    setLoadMoreLoading(true);
    setCatalogError(null);
    try {
      const res =
        debouncedSearch.length > 0
          ? await api.searchVoiceCatalog({
              q: debouncedSearch,
              page: nextPage,
              page_size: 100,
            })
          : await api.listVoiceCatalog({ page: nextPage, page_size: 100 });
      setVoiceHub({
        ...res,
        voices: [...voiceHub.voices, ...res.voices],
      });
    } catch (e) {
      setCatalogError(
        e instanceof ApiError ? e.message : "Failed to load more voices",
      );
    } finally {
      setLoadMoreLoading(false);
    }
  }

  const selected = characters.find((c) => c.id === selectedId) ?? null;

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
    setTab("browse");
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
    setStyleInput("");
    setPreview(null);
    setPreviewError(null);
    setSaveSuccess(false);
    const panel = (searchParams.get("panel") || "").trim().toLowerCase();
    if (panel === "voice") {
      setEditingVoice(true);
      setShowClipGenerator(false);
      return;
    }
    if (panel === "clips") {
      setEditingVoice(false);
      setShowClipGenerator(true);
      return;
    }
    if (c.default_voice_id) {
      setEditingVoice(false);
      setShowClipGenerator(true);
    } else {
      setEditingVoice(true);
      setShowClipGenerator(false);
    }
  }, [selectedId, characters, searchParams]);

  async function handleAssignVoice() {
    if (!selected || !chosenVoiceId || !voiceHub) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const picked = voiceHub.voices.find((v) => v.voice_id === chosenVoiceId);
      const updated = await api.assignVoice(selected.id, {
        voice_id: chosenVoiceId,
        provider:
          voiceHub.source === "elevenlabs" ? "elevenlabs" : "local_builtin",
        display_name: picked?.display_name ?? chosenVoiceId,
        voice_source_type: "catalog",
      });
      setCharacters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      setSaveSuccess(true);
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
    setPreview(null);
    setPreviewError(null);
    try {
      await api.generateCharacterClipsFromLines(selected.id, {
        lines: lines.map((text) => ({
          text,
          tone_style: styleInput.trim() || "",
        })),
        style: styleInput.trim() || undefined,
        clip_label_prefix: clipLabel.trim() || undefined,
        voice_id: selected.default_voice_id || undefined,
      });
      const rows = await api.listCharacterClips(selected.id);
      setClips(rows);
      if (directInputMode === "multi_line") setDirectLinesInput("");
      else setSampleText("");
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
      .map((x) => ({
        text: x.text.trim(),
        tone_style: (x.tone_style || "").trim(),
      }))
      .filter((x) => x.text);
    if (lines.length === 0) {
      setPreviewError("Generate and keep at least one line before audio generation.");
      return;
    }
    setGenerating(true);
    setPreview(null);
    setPreviewError(null);
    try {
      await api.generateCharacterClipsFromLines(selected.id, {
        lines,
        voice_id: selected.default_voice_id || undefined,
      });
      const rows = await api.listCharacterClips(selected.id);
      setClips(rows);
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

  async function handleDeleteClip(clipId: string) {
    if (!globalThis.confirm("Delete this clip from your library?")) return;
    setClipBusyId(clipId);
    try {
      await api.deleteVoiceClip(clipId);
      setClips((prev) => prev.filter((c) => c.id !== clipId));
    } finally {
      setClipBusyId(null);
    }
  }

  const rows = voiceHub?.voices ?? [];

  const remixEligible =
    !!selected?.default_voice_id &&
    (selected.voice_source_type === "designed" ||
      selected.voice_source_type === "remixed");

  async function handleDesignGenerate() {
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
    } catch (e) {
      setDesignErr(
        e instanceof ApiError ? e.message : "Could not save designed voice",
      );
    } finally {
      setDesignSaveLoading(false);
    }
  }

  async function handleRemixGenerate() {
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
    } catch (e) {
      setRemixErr(
        e instanceof ApiError ? e.message : "Could not save remixed voice",
      );
    } finally {
      setRemixSaveLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Voice Studio"
        subtitle="Assign voices to characters, or explore the catalog. Designed and remixed voices save to the character you pick."
      />

      <Panel>
        <p className="text-sm leading-relaxed text-muted">
          <span className="font-medium text-text">Flow: </span>
          pick a character under Character Voice, then browse, design, or remix.
          Preview a line to hear the result. Voices you save stay on that
          character for Replace Lines.
        </p>
      </Panel>

      {error ? <ErrorBanner title="Voice studio" detail={error} /> : null}

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Panel key={i}>
              <Skeleton className="h-24 w-full" />
            </Panel>
          ))}
        </div>
      ) : characters.length === 0 ? (
        <EmptyState
          icon={Mic2}
          title="No characters in this project"
          description="Add characters on the Characters page, or use Import from Video to create them from speakers."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
          <div className="space-y-6">
          <Panel>
            <h2 className="text-sm font-semibold text-text">
              Character Voice
            </h2>
            <p className="mt-1 text-xs text-muted">
              Select who you are working on. Browse attaches a catalog voice.
              Design creates a new voice from a prompt. Remix variants a voice you
              already created here.
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Characters ({characters.length})
            </p>
            <ul className="mt-4 max-h-[560px] space-y-2 overflow-y-auto">
              {characters.map((c) => (
                <li key={c.id}>
                  <button
                    className={`w-full rounded-xl p-3 text-left transition ring-1 ${
                      selectedId === c.id
                        ? "bg-accent/10 ring-accent/40"
                        : "bg-white/[0.02] ring-white/[0.06] hover:bg-white/[0.04]"
                    }`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {characterAvatarSrc(c) ? (
                          <img
                            src={characterAvatarSrc(c) ?? ""}
                            alt={`${c.name} avatar`}
                            className="h-7 w-7 rounded-full object-cover ring-1 ring-white/20"
                          />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/[0.1]">
                            <span className="text-[10px] font-semibold text-text">
                              {initials(c.name)}
                            </span>
                          </div>
                        )}
                        <span className="truncate text-sm font-medium text-text">
                          {c.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {c.is_narrator ? (
                          <Badge tone="violet">Narrator</Badge>
                        ) : null}
                        {c.default_voice_id ? (
                          <Badge tone="success">
                            {c.voice_display_name || c.default_voice_id}
                          </Badge>
                        ) : (
                          <Badge tone="default">No voice</Badge>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {c.segment_count} segments ·{" "}
                      {c.total_speaking_duration.toFixed(1)}s
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="opacity-90 transition hover:opacity-100">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Project voice library
            </h2>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Voices in use anywhere in this project. Attach the same catalog
              voice to another character from Browse when your provider allows it.
            </p>
            <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto text-xs">
              {characters.every((c) => !c.default_voice_id) ? (
                <li className="text-xs text-muted">
                  No voices assigned yet. Start with a character on the right.
                </li>
              ) : (
                [...new Set(characters.map((c) => c.default_voice_id).filter(Boolean))].map(
                  (vid) => {
                    const names = characters
                      .filter((c) => c.default_voice_id === vid)
                      .map((c) => c.name);
                    const sample = characters.find((c) => c.default_voice_id === vid);
                    const label = sample?.voice_display_name || String(vid);
                    return (
                      <li
                        key={String(vid)}
                        className="rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-white/[0.06]"
                      >
                        <p className="font-medium text-text">{label}</p>
                        <p className="text-[11px] text-muted">
                          Used by: {names.join(", ")}
                        </p>
                      </li>
                    );
                  },
                )
              )}
            </ul>
          </Panel>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Library className="h-4 w-4 text-muted" />
                <h3 className="text-sm font-semibold text-text">
                  Character Audio Library
                </h3>
              </div>
              {selected && clips.length > 0 ? (
                <a
                  href={api.characterClipsZipUrl(selected.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-text ring-1 ring-white/[0.1] transition hover:bg-white/[0.1]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download all
                </a>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted">
              {selected
                ? `Clips for ${selected.name}`
                : "Select a character to view clips"}
            </p>
            {!selected ? (
              <p className="mt-3 text-xs text-muted">No character selected.</p>
            ) : clipsLoading ? (
              <p className="mt-3 text-xs text-muted">Loading clips…</p>
            ) : clips.length === 0 ? (
              <p className="mt-3 text-xs text-muted">
                No clips yet. Use Generate clips on the right.
              </p>
            ) : (
              <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-lg p-2 ring-1 ring-white/[0.06]">
                {clips.map((cl) => (
                  <li
                    key={cl.id}
                    className="rounded-lg bg-white/[0.02] p-2 ring-1 ring-white/[0.05] transition hover:bg-white/[0.04]"
                  >
                    <input
                      key={`${cl.id}-${cl.title}`}
                      className="mb-1 w-full rounded border border-white/[0.08] bg-canvas/80 px-2 py-1 text-xs text-text outline-none focus:border-accent/40"
                      defaultValue={cl.title}
                      disabled={clipBusyId === cl.id}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== cl.title) void handleRenameClip(cl, v);
                      }}
                    />
                    <p className="line-clamp-2 text-[11px] text-muted">{cl.text}</p>
                    {cl.tone_style_hint ? (
                      <p className="mt-1 text-[10px] text-muted">
                        Tone: {cl.tone_style_hint}
                      </p>
                    ) : null}
                    <audio
                      controls
                      className="mt-1 h-9 w-full"
                      src={mediaUrl(cl.audio_url.replace(/^\/media\//, ""))}
                    />
                    <div className="mt-1 flex flex-wrap gap-3">
                      <a
                        href={mediaUrl(cl.audio_url.replace(/^\/media\//, ""))}
                        download
                        className="text-[11px] font-medium text-accent hover:underline"
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400/90 hover:underline disabled:opacity-50"
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

          <Panel>
            {!selected ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                <Volume2 className="h-10 w-10 text-muted" />
                <p className="mt-4 text-sm text-muted">
                  Select a character to assign a voice and generate preview
                  speech.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.08]">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Character summary
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {characterAvatarSrc(selected) ? (
                        <img
                          src={characterAvatarSrc(selected) ?? ""}
                          alt={`${selected.name} avatar`}
                          className="h-10 w-10 rounded-full object-cover ring-1 ring-white/20"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/[0.12]">
                          <span className="text-xs font-semibold text-text">
                            {initials(selected.name)}
                          </span>
                        </div>
                      )}
                      <div>
                        <h2 className="text-lg font-semibold text-text">
                          {selected.name}
                        </h2>
                        <p className="text-xs text-muted">
                          {selected.source_speaker_labels.length > 0
                            ? "Imported from video"
                            : "Manual character"}
                        </p>
                      </div>
                    </div>
                    {selected.is_narrator ? (
                      <Badge tone="violet">Narrator</Badge>
                    ) : null}
                  </div>
                  {selected.default_voice_id ? (
                    <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 ring-1 ring-emerald-400/20">
                      <p className="text-xs text-muted">Assigned voice</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-text">
                          {selected.voice_display_name || selected.default_voice_id}
                        </span>
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
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 ring-1 ring-amber-500/25">
                      <p className="text-xs text-amber-100/90">
                        No assigned voice yet. Set up a voice first.
                      </p>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setEditingVoice(true)}
                    >
                      Change voice
                    </Button>
                    <Button
                      onClick={() => setShowClipGenerator((v) => !v)}
                      disabled={!selected.default_voice_id}
                    >
                      {showClipGenerator ? "Hide clip generator" : "Generate clips"}
                    </Button>
                    {editingVoice ? (
                      <Button
                        variant="ghost"
                        onClick={() => setEditingVoice(false)}
                      >
                        Cancel voice editing
                      </Button>
                    ) : null}
                  </div>
                </div>

                {showClipGenerator ? (
                  <div className="space-y-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.08] transition hover:ring-white/12">
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-accent" />
                    <h3 className="text-sm font-semibold text-text">
                      Generate clips
                    </h3>
                  </div>
                  <p className="text-xs leading-relaxed text-muted">
                    Use this character&apos;s assigned voice to create one or more clips.
                  </p>

                  {!showDirectTextAdvanced ? (
                    <>
                      <div className="space-y-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-white/[0.06]">
                        <p className="text-xs leading-relaxed text-muted">
                          Describe the scene or plot for this character. We will draft lines
                          and tones for review.
                        </p>
                        <label className="block text-[11px] font-medium text-muted">
                          Scene / plot prompt
                        </label>
                        <textarea
                          className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                          rows={4}
                          maxLength={SCENE_PROMPT_MAX_CHARS}
                          placeholder="What is happening in the scene?"
                          value={promptInput}
                          onChange={(e) => {
                            setPromptInput(e.target.value);
                            setPreviewError(null);
                          }}
                        />
                        <p className="text-right text-[10px] text-muted">
                          {promptInput.length}/{SCENE_PROMPT_MAX_CHARS}
                        </p>
                        <Button
                          variant="secondary"
                          type="button"
                          className="w-full"
                          onClick={() => void handleGenerateLinesFromPrompt()}
                          disabled={
                            promptLinesBusy ||
                            !promptInput.trim() ||
                            promptInput.trim().length > SCENE_PROMPT_MAX_CHARS
                          }
                        >
                          {promptLinesBusy ? (
                            <>
                              <Spinner className="h-4 w-4 border-t-text" />
                              Generating draft lines…
                            </>
                          ) : (
                            "Generate draft lines"
                          )}
                        </Button>
                      </div>

                      {promptLines.length > 0 ? (
                        <div className="space-y-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-white/[0.06]">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-medium text-muted">
                              Review lines
                            </p>
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
                              <li
                                key={line.id}
                                className="space-y-2 rounded-lg bg-white/[0.02] p-2 ring-1 ring-white/[0.06]"
                              >
                                <textarea
                                  className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                                  rows={2}
                                  placeholder="Line text"
                                  value={line.text}
                                  onChange={(e) =>
                                    setPromptLines((prev) =>
                                      prev.map((x) =>
                                        x.id === line.id ? { ...x, text: e.target.value } : x,
                                      ),
                                    )
                                  }
                                />
                                <div className="flex items-center gap-2">
                                  <input
                                    className="flex-1 rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                                    placeholder="Tone (suggested)"
                                    value={line.tone_style}
                                    onChange={(e) =>
                                      setPromptLines((prev) =>
                                        prev.map((x) =>
                                          x.id === line.id
                                            ? { ...x, tone_style: e.target.value }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() =>
                                      setPromptLines((prev) =>
                                        prev.filter((x) => x.id !== line.id),
                                      )
                                    }
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                          <Button
                            type="button"
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
                              <>
                                <Play className="h-4 w-4" />
                                Approve and generate audio
                              </>
                            )}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  <div className="space-y-2">
                    <button
                      type="button"
                      className="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                      onClick={() => setShowDirectTextAdvanced((v) => !v)}
                    >
                      {showDirectTextAdvanced
                        ? "Back to scene prompt flow"
                        : "Use direct text instead"}
                    </button>
                  </div>

                  {showDirectTextAdvanced ? (
                    <div className="space-y-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-white/[0.06]">
                      <p className="text-[11px] text-muted">
                        Advanced: enter exact lines to speak.
                      </p>
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
                        <div>
                          <label className="block text-[11px] font-medium text-muted">
                            Single line text
                          </label>
                          <textarea
                            className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                            rows={3}
                            placeholder="Text for one clip"
                            value={sampleText}
                            onChange={(e) => setSampleText(e.target.value)}
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[11px] font-medium text-muted">
                            Multi-line input
                          </label>
                          <textarea
                            className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                            rows={5}
                            placeholder="One line per clip"
                            value={directLinesInput}
                            onChange={(e) => setDirectLinesInput(e.target.value)}
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[11px] font-medium text-muted">
                          Tone / style for clips (optional)
                        </label>
                        <input
                          className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                          placeholder="e.g. calm, urgent, dry"
                          value={styleInput}
                          onChange={(e) => setStyleInput(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-muted">
                          Clip label prefix (optional)
                        </label>
                        <input
                          className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                          placeholder="e.g. Greeting take 2"
                          value={clipLabel}
                          onChange={(e) => setClipLabel(e.target.value)}
                        />
                        <p className="mt-1 text-[10px] text-muted">
                          Used only for organizing saved clips.
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => void handleGenerateDirectClips()}
                        disabled={
                          generating ||
                          !selected.default_voice_id ||
                          (directInputMode === "single_line"
                            ? !sampleText.trim()
                            : !directLinesInput.trim())
                        }
                        className="w-full"
                      >
                        {generating ? (
                          <>
                            <Spinner className="h-4 w-4 border-t-canvas" />
                            Generating…
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" />
                            Generate audio clips
                          </>
                        )}
                      </Button>
                    </div>
                  ) : null}
                  {previewError ? (
                    <ErrorBanner title="Generation failed" detail={previewError} />
                  ) : null}
                  {preview ? (
                    <div className="rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Volume2 className="h-4 w-4 text-accent" />
                          <span className="text-sm font-medium text-text">
                            Latest preview
                          </span>
                        </div>
                        <Badge
                          tone={
                            preview.provider === "elevenlabs"
                              ? "success"
                              : "default"
                          }
                        >
                          {preview.provider === "stub"
                            ? "fallback"
                            : preview.provider}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs italic text-muted">
                        &ldquo;{preview.text}&rdquo;
                      </p>
                      {preview.clip_id ? (
                        <p className="mt-1 text-[10px] text-emerald-400/90">
                          Saved to library
                        </p>
                      ) : null}
                      <audio
                        controls
                        className="mt-3 w-full"
                        src={mediaUrl(preview.audio_url.replace(/^\/media\//, ""))}
                      />
                      {preview.provider === "stub" ? (
                        <p className="mt-2 text-[11px] text-amber-400">
                          Fallback audio. Set ELEVENLABS_API_KEY for live speech.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                ) : null}

                {editingVoice ? (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Voice setup
                  </p>
                  <p className="text-xs text-muted">
                    Choose, design, or remix this character voice.
                  </p>
                  <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
                  {(
                    [
                      {
                        id: "browse" as const,
                        label: "Browse",
                        Icon: LayoutGrid,
                      },
                      {
                        id: "design" as const,
                        label: "Design",
                        Icon: Sparkles,
                      },
                      {
                        id: "remix" as const,
                        label: "Remix",
                        Icon: Wand2,
                      },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        tab === id
                          ? "bg-accent/20 text-text ring-1 ring-accent/35"
                          : "bg-white/[0.04] text-muted hover:bg-white/[0.07]"
                      }`}
                      onClick={() => setTab(id)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                {tab === "browse" ? (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                      Browse: pick an existing voice
                    </label>
                    {voiceHub ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            voiceHub.source === "elevenlabs"
                              ? "success"
                              : "default"
                          }
                        >
                          {voiceHub.source === "elevenlabs"
                            ? "Live library"
                            : "Backup catalog"}
                        </Badge>
                        <span className="text-[11px] text-muted">
                          {voiceHub.total} voices
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {voiceHub?.message ? (
                    <p className="mt-1 text-[11px] text-amber-400/90">
                      {voiceHub.message}
                    </p>
                  ) : null}
                  {catalogError ? (
                    <p className="mt-1 text-[11px] text-red-400">
                      {catalogError}
                    </p>
                  ) : null}

                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      type="search"
                      className="w-full rounded-lg border border-white/[0.12] bg-canvas/80 py-2 pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                      placeholder="Search by name, tag, or description…"
                      value={voiceSearchInput}
                      onChange={(e) => setVoiceSearchInput(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  {catalogLoading ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                      <Spinner className="h-4 w-4 border-t-accent" />
                      Loading voices…
                    </div>
                  ) : (
                    <div className="mt-3 max-h-[280px] space-y-1.5 overflow-y-auto rounded-lg ring-1 ring-white/[0.06]">
                      {rows.length === 0 ? (
                        <p className="p-4 text-center text-xs text-muted">
                          No voices match your search.
                        </p>
                      ) : (
                        rows.map((v) => {
                          const active = chosenVoiceId === v.voice_id;
                          return (
                            <button
                              key={v.voice_id}
                              type="button"
                              className={`flex w-full flex-col gap-1 border-b border-white/[0.04] px-3 py-2.5 text-left text-sm last:border-0 ${
                                active
                                  ? "bg-accent/15"
                                  : "hover:bg-white/[0.03]"
                              }`}
                              onClick={() => {
                                setChosenVoiceId(v.voice_id);
                                setSaveSuccess(false);
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-medium text-text">
                                  {v.display_name}
                                </span>
                                {active ? (
                                  <Badge tone="accent">Selected</Badge>
                                ) : null}
                              </div>
                              {v.tags && v.tags.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {v.tags.slice(0, 6).map((t) => (
                                    <span
                                      key={t}
                                      className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              {v.description ? (
                                <p className="line-clamp-2 text-[11px] text-muted">
                                  {v.description}
                                </p>
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                  {voiceHub?.has_more ? (
                    <div className="mt-2 flex justify-center">
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={loadMoreLoading || catalogLoading}
                        onClick={() => void handleLoadMoreVoices()}
                      >
                        {loadMoreLoading ? (
                          <>
                            <Spinner className="h-4 w-4 border-t-text" />
                            Loading…
                          </>
                        ) : (
                          "Load more voices"
                        )}
                      </Button>
                    </div>
                  ) : null}
                  {chosenVoiceId && !rows.some((v) => v.voice_id === chosenVoiceId) ? (
                    <p className="mt-2 text-[11px] text-muted">
                      Assigned voice id:{" "}
                      <code className="text-xs">{chosenVoiceId}</code> (scroll or
                      search if it is not in the current list)
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => void handleAssignVoice()}
                      disabled={saving || !chosenVoiceId || !voiceHub}
                    >
                      {saving ? (
                        <Spinner className="h-4 w-4 border-t-text" />
                      ) : null}
                      Save voice
                    </Button>
                    {saveSuccess ? (
                      <span className="text-xs text-green-400">Saved!</span>
                    ) : null}
                  </div>
                </div>
                ) : null}

                {tab === "design" ? (
                  <div className="space-y-4">
                    <p className="text-[11px] text-muted">
                      Design: describe a new voice. You get preview clips. Pick
                      one and save it to this character.
                    </p>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                        Voice description
                      </label>
                      <textarea
                        className="mt-2 min-h-[88px] w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                        placeholder="e.g. Warm alto narrator, slight rasp, steady pacing…"
                        value={designDesc}
                        onChange={(e) => setDesignDesc(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                        Preview line
                      </label>
                      <textarea
                        className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                        rows={3}
                        placeholder="Text to synthesize for each preview (100+ chars recommended)."
                        value={designPreviewText}
                        onChange={(e) => setDesignPreviewText(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={designLoading || !designDesc.trim()}
                      onClick={() => void handleDesignGenerate()}
                    >
                      {designLoading ? (
                        <>
                          <Spinner className="h-4 w-4 border-t-text" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Generate voice options
                        </>
                      )}
                    </Button>
                    {designErr ? (
                      <ErrorBanner title="Design" detail={designErr} />
                    ) : null}
                    {designResult?.source === "fallback" &&
                    designResult.message ? (
                      <div className="space-y-2">
                        <p className="text-[11px] text-amber-400/90">
                          {designResult.message}
                        </p>
                        <p className="text-[11px] text-muted">
                          Try describing the sound and style rather than age labels.
                        </p>
                        {designResult.safe_example_prompts &&
                        designResult.safe_example_prompts.length > 0 ? (
                          <ul className="space-y-1 rounded-lg bg-white/[0.02] p-2 ring-1 ring-white/[0.06]">
                            {designResult.safe_example_prompts
                              .slice(0, 6)
                              .map((sample) => (
                                <li key={sample} className="text-[11px] text-muted">
                                  {sample}
                                </li>
                              ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                    {designResult?.source === "elevenlabs" &&
                    designResult.normalized_retry_used ? (
                      <p className="text-[11px] text-muted">
                        We adjusted the prompt for compatibility.
                      </p>
                    ) : null}
                    {designResult &&
                    designResult.candidates.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs font-medium text-text">
                          Candidates
                        </p>
                        <div className="grid gap-3 sm:grid-cols-1">
                          {designResult.candidates.map((c) => (
                            <div
                              key={c.generated_voice_id}
                              className={`rounded-xl p-3 ring-1 ${
                                designPickGid === c.generated_voice_id
                                  ? "bg-accent/10 ring-accent/40"
                                  : "bg-white/[0.02] ring-white/[0.06]"
                              }`}
                            >
                              <button
                                type="button"
                                className="w-full text-left"
                                onClick={() =>
                                  setDesignPickGid(c.generated_voice_id)
                                }
                              >
                                <span className="text-sm font-medium text-text">
                                  {c.label}
                                </span>
                              </button>
                              <audio
                                controls
                                className="mt-2 w-full"
                                src={audioSrcFromApiPath(c.preview_audio_url)}
                              />
                            </div>
                          ))}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                            Name for saved voice
                          </label>
                          <input
                            className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                            value={designVoiceName}
                            onChange={(e) => setDesignVoiceName(e.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          disabled={
                            designSaveLoading ||
                            !designPickGid ||
                            !designVoiceName.trim()
                          }
                          onClick={() => void handleDesignSave()}
                          className="w-full"
                        >
                          {designSaveLoading ? (
                            <>
                              <Spinner className="h-4 w-4 border-t-canvas" />
                              Saving…
                            </>
                          ) : (
                            "Save selected voice to character"
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {tab === "remix" ? (
                  <div className="space-y-4">
                    {!remixEligible ? (
                      <p className="text-[11px] leading-relaxed text-amber-400/90">
                        Remix needs a voice you created in{" "}
                        <strong className="font-medium text-text">Design</strong>{" "}
                        or an earlier{" "}
                        <strong className="font-medium text-text">Remix</strong>.
                        Catalog voices cannot be remixed. Assign a custom voice
                        first, or keep a catalog voice as-is from Browse.
                      </p>
                    ) : (
                      <>
                        <p className="text-[11px] text-muted">
                          Base voice:{" "}
                          <span className="font-medium text-text">
                            {selected.voice_display_name ||
                              selected.default_voice_id}
                          </span>
                          <code className="ml-1 text-[10px] text-muted">
                            {selected.default_voice_id}
                          </code>
                        </p>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                            Remix prompt
                          </label>
                          <textarea
                            className="mt-2 min-h-[80px] w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                            placeholder="How should this voice change? e.g. younger, slower, more breathy…"
                            value={remixPrompt}
                            onChange={(e) => setRemixPrompt(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                            Preview line
                          </label>
                          <textarea
                            className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                            rows={3}
                            value={remixPreviewText}
                            onChange={(e) => setRemixPreviewText(e.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled={
                            remixLoading || !remixPrompt.trim() || !remixEligible
                          }
                          onClick={() => void handleRemixGenerate()}
                        >
                          {remixLoading ? (
                            <>
                              <Spinner className="h-4 w-4 border-t-text" />
                              Generating…
                            </>
                          ) : (
                            <>
                              <Wand2 className="h-4 w-4" />
                              Generate remix variants
                            </>
                          )}
                        </Button>
                        {remixErr ? (
                          <ErrorBanner title="Remix" detail={remixErr} />
                        ) : null}
                        {remixResult?.source === "fallback" &&
                        remixResult.message ? (
                          <p className="text-[11px] text-amber-400/90">
                            {remixResult.message}
                          </p>
                        ) : null}
                        {remixResult &&
                        remixResult.candidates.length > 0 ? (
                          <div className="space-y-3">
                            <p className="text-xs font-medium text-text">
                              Variants
                            </p>
                            {remixResult.candidates.map((c) => (
                              <div
                                key={c.generated_voice_id}
                                className={`rounded-xl p-3 ring-1 ${
                                  remixPickGid === c.generated_voice_id
                                    ? "bg-accent/10 ring-accent/40"
                                    : "bg-white/[0.02] ring-white/[0.06]"
                                }`}
                              >
                                <button
                                  type="button"
                                  className="w-full text-left"
                                  onClick={() =>
                                    setRemixPickGid(c.generated_voice_id)
                                  }
                                >
                                  <span className="text-sm font-medium text-text">
                                    {c.label}
                                  </span>
                                </button>
                                <audio
                                  controls
                                  className="mt-2 w-full"
                                  src={audioSrcFromApiPath(c.preview_audio_url)}
                                />
                              </div>
                            ))}
                            <div>
                              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                                Name for saved voice
                              </label>
                              <input
                                className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                                value={remixVoiceName}
                                onChange={(e) => setRemixVoiceName(e.target.value)}
                              />
                            </div>
                            <Button
                              type="button"
                              disabled={
                                remixSaveLoading ||
                                !remixPickGid ||
                                !remixVoiceName.trim()
                              }
                              onClick={() => void handleRemixSave()}
                              className="w-full"
                            >
                              {remixSaveLoading ? (
                                <>
                                  <Spinner className="h-4 w-4 border-t-canvas" />
                                  Saving…
                                </>
                              ) : (
                                "Save variant to character"
                              )}
                            </Button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
                </div>
                ) : null}
              </div>
            )}
          </Panel>
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
