"use client";

import { useCallback, useEffect, useState } from "react";
import { Mic2, Play, Volume2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto, PreviewDto, VoiceCatalogItem } from "@/lib/api/types";
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
  const [catalog, setCatalog] = useState<VoiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosenVoiceId, setChosenVoiceId] = useState<string>("");
  const [sampleText, setSampleText] = useState("");
  const [styleInput, setStyleInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<PreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadData = useCallback(async () => {
    if (!activeProjectId) {
      setCharacters([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [chars, voices] = await Promise.all([
        api.listCharacters(activeProjectId),
        api.listVoiceCatalog(),
      ]);
      setCharacters(chars);
      setCatalog(voices);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
    if (!selected || !chosenVoiceId) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const catalogItem = catalog.find((v) => v.voice_id === chosenVoiceId);
      const updated = await api.assignVoice(selected.id, {
        voice_id: chosenVoiceId,
        provider: "catalog",
        display_name: catalogItem?.display_name ?? chosenVoiceId,
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
          {/* Character list */}
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
                      {c.segment_count} segments · {c.total_speaking_duration.toFixed(1)}s
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {/* Voice config + preview */}
          <Panel>
            {!selected ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                <Volume2 className="h-10 w-10 text-muted" />
                <p className="mt-4 text-sm text-muted">
                  Select a character to assign a voice and generate preview speech.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
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

                {/* Voice catalog picker */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Assign voice
                  </label>
                  <select
                    className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                    value={chosenVoiceId}
                    onChange={(e) => {
                      setChosenVoiceId(e.target.value);
                      setSaveSuccess(false);
                    }}
                  >
                    <option value="">— Select a voice —</option>
                    {catalog.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.display_name} — {v.suggested_use}
                      </option>
                    ))}
                  </select>
                  {chosenVoiceId ? (
                    <p className="mt-1 text-[11px] text-muted">
                      {catalog.find((v) => v.voice_id === chosenVoiceId)?.description}
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => void handleAssignVoice()}
                      disabled={saving || !chosenVoiceId}
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

                {/* Sample text */}
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

                {/* Tone / style */}
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

                {/* Generate */}
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

                {/* Preview error */}
                {previewError ? (
                  <ErrorBanner title="Preview failed" detail={previewError} />
                ) : null}

                {/* Audio player */}
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
                        {preview.provider === "stub" ? "fallback" : preview.provider}
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
