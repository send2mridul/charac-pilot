"use client";

import { useEffect, useState } from "react";
import { Mic2, Play, SlidersHorizontal, Volume2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto, PreviewDto } from "@/lib/api/types";
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voiceIdInput, setVoiceIdInput] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [styleInput, setStyleInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<PreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
          setError(e instanceof ApiError ? e.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const selected = characters.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setVoiceIdInput(selected.default_voice_id ?? "");
    setSampleText(selected.sample_texts[0] ?? "");
    setStyleInput("");
    setPreview(null);
    setPreviewError(null);
  }, [selectedId]);

  async function handleSaveVoice() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patchCharacter(selected.id, {
        default_voice_id: voiceIdInput || null,
      });
      setCharacters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
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
        voice_id: voiceIdInput || undefined,
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
        subtitle="Select a character, assign a voice ID, and generate TTS preview lines."
        actions={
          <Button variant="secondary">
            <SlidersHorizontal className="h-4 w-4" />
            Mix presets
          </Button>
        }
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
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Character selection list */}
          <Panel>
            <h2 className="text-sm font-semibold text-text">
              Characters ({characters.length})
            </h2>
            <ul className="mt-4 max-h-[500px] space-y-2 overflow-y-auto">
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
                          <Badge tone="success">Voice set</Badge>
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
                  Select a character to configure voice and generate previews.
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
                </div>

                {/* Voice ID */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Default voice ID
                  </label>
                  <p className="mt-1 text-[11px] text-muted">
                    ElevenLabs voice ID, or leave blank for stub preview.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                      placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
                      value={voiceIdInput}
                      onChange={(e) => setVoiceIdInput(e.target.value)}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => void handleSaveVoice()}
                      disabled={saving}
                    >
                      {saving ? (
                        <Spinner className="h-4 w-4 border-t-text" />
                      ) : null}
                      Save
                    </Button>
                  </div>
                  {selected.default_voice_id ? (
                    <p className="mt-2 text-[11px] text-muted">
                      Current: <code className="text-xs">{selected.default_voice_id}</code>
                    </p>
                  ) : null}
                </div>

                {/* Sample text */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Sample line
                  </label>
                  <textarea
                    className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                    rows={3}
                    placeholder="Type a line for this character to say…"
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                  />
                </div>

                {/* Style / tone */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Tone / style (optional)
                  </label>
                  <input
                    className="mt-2 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                    placeholder="e.g. calm, dramatic, whisper"
                    value={styleInput}
                    onChange={(e) => setStyleInput(e.target.value)}
                  />
                </div>

                {/* Generate button */}
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
                  <ErrorBanner
                    title="Preview failed"
                    detail={previewError}
                  />
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
                        {preview.provider}
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
