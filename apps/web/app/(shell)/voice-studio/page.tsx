"use client";

import { useEffect, useState } from "react";
import { Mic2, Play, Search, Volume2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  PreviewDto,
  VoiceCatalogResponse,
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

export default function VoiceStudioPage() {
  const { activeProjectId } = useProjects();
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
    if (!selected) return;
    setChosenVoiceId(selected.default_voice_id ?? "");
    setSampleText(selected.sample_texts[0] ?? "");
    setStyleInput("");
    setPreview(null);
    setPreviewError(null);
    setSaveSuccess(false);
  }, [selectedId]);

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

  async function handleGenerate() {
    if (!selected || !sampleText.trim()) return;
    setGenerating(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const result = await api.generatePreview(selected.id, {
        text: sampleText.trim(),
        voice_id: chosenVoiceId || undefined,
        style: styleInput || undefined,
      });
      setPreview(result);
    } catch (e) {
      setPreviewError(
        e instanceof ApiError ? e.message : "Preview generation failed",
      );
    } finally {
      setGenerating(false);
    }
  }

  const rows = voiceHub?.voices ?? [];

  return (
    <div className="space-y-10">
      <PageHeader
        title="Voice Studio"
        subtitle="Assign AI voices to characters and generate preview speech with tone/style."
      />

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
          title="No characters"
          description="Create characters from speaker groups in Upload / Match first."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
          <Panel>
            <h2 className="text-sm font-semibold text-text">
              Characters ({characters.length})
            </h2>
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
                      <span className="text-sm font-medium text-text">
                        {c.name}
                      </span>
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
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-text">
                      {selected.name}
                    </h2>
                    {selected.is_narrator ? (
                      <Badge tone="violet">Narrator</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {selected.source_speaker_labels.join(", ") || "Manual entry"}{" "}
                    · {selected.segment_count} segments
                  </p>
                  {selected.voice_display_name ? (
                    <p className="mt-2 text-xs text-muted">
                      Current voice:{" "}
                      <span className="font-medium text-text">
                        {selected.voice_display_name}
                      </span>
                      {selected.voice_provider ? (
                        <span className="ml-1 text-muted">
                          ({selected.voice_provider})
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                      Voice library
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
                            ? "ElevenLabs"
                            : "Built-in fallback"}
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

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Preview line
                  </label>
                  <textarea
                    className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                    rows={3}
                    placeholder="Type a line for this character to say…"
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Tone / style (optional)
                  </label>
                  <input
                    className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                    placeholder="e.g. calm, dramatic, whisper, excited"
                    value={styleInput}
                    onChange={(e) => setStyleInput(e.target.value)}
                  />
                </div>

                <Button
                  onClick={() => void handleGenerate()}
                  disabled={generating || !sampleText.trim()}
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
                      Generate preview
                    </>
                  )}
                </Button>

                {previewError ? (
                  <ErrorBanner title="Preview failed" detail={previewError} />
                ) : null}

                {preview ? (
                  <div className="rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Volume2 className="h-4 w-4 text-accent" />
                        <span className="text-sm font-medium text-text">
                          Preview ready
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
                    <p className="mt-1 text-[11px] text-muted">
                      {preview.duration_ms}ms · {preview.preview_id}
                    </p>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio
                      controls
                      className="mt-3 w-full"
                      src={mediaUrl(preview.audio_url.replace(/^\/media\//, ""))}
                    />
                    {preview.provider === "stub" ? (
                      <p className="mt-2 text-[11px] text-amber-400">
                        Fallback mode — set ELEVENLABS_API_KEY for real speech.
                      </p>
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
