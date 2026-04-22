"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Mic2, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { mediaUrl } from "@/lib/api/media";
import { ApiError } from "@/lib/api/errors";
import type {
  CharacterDto,
  EpisodeDto,
  ReplacementDto,
  TranscriptSegmentDto,
} from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";

function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function ReplaceLinesContent() {
  const toast = useToast();
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    loading: projectsLoading,
  } = useProjects();
  const searchParams = useSearchParams();

  const [episodes, setEpisodes] = useState<EpisodeDto[]>([]);
  const [epLoading, setEpLoading] = useState(false);
  const [episodeId, setEpisodeId] = useState<string>("");

  const [segments, setSegments] = useState<TranscriptSegmentDto[]>([]);
  const [segLoading, setSegLoading] = useState(false);

  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [charLoading, setCharLoading] = useState(false);

  const [replacements, setReplacements] = useState<ReplacementDto[]>([]);
  const [repLoading, setRepLoading] = useState(false);

  const [selectedSegId, setSelectedSegId] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string>("");
  const [replacementText, setReplacementText] = useState("");
  const [toneStyle, setToneStyle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRepId, setEditingRepId] = useState<string | null>(null);

  useEffect(() => {
    const e = searchParams.get("episode");
    const s = searchParams.get("segment");
    if (e) setEpisodeId(e);
    if (s) setSelectedSegId(s);
  }, [searchParams]);

  useEffect(() => {
    if (!activeProjectId) {
      setEpisodes([]);
      setEpisodeId("");
      return;
    }
    let c = false;
    setEpLoading(true);
    api
      .listEpisodes(activeProjectId)
      .then((rows) => {
        if (!c) setEpisodes(rows);
      })
      .catch(() => {
        if (!c) setEpisodes([]);
      })
      .finally(() => {
        if (!c) setEpLoading(false);
      });
    return () => {
      c = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setCharacters([]);
      return;
    }
    let c = false;
    setCharLoading(true);
    api
      .listCharacters(activeProjectId)
      .then((rows) => {
        if (!c) setCharacters(rows);
      })
      .catch(() => {
        if (!c) setCharacters([]);
      })
      .finally(() => {
        if (!c) setCharLoading(false);
      });
    return () => {
      c = true;
    };
  }, [activeProjectId]);

  const loadSegments = useCallback(async (eid: string) => {
    setSegLoading(true);
    setError(null);
    try {
      const rows = await api.listEpisodeTranscriptSegments(eid);
      setSegments(rows);
    } catch (e) {
      setSegments([]);
      setError(e instanceof ApiError ? e.message : "Could not load segments");
    } finally {
      setSegLoading(false);
    }
  }, []);

  const loadReplacements = useCallback(async (eid: string) => {
    setRepLoading(true);
    try {
      const rows = await api.listEpisodeReplacements(eid);
      setReplacements(rows);
    } catch {
      setReplacements([]);
    } finally {
      setRepLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!episodeId) {
      setSegments([]);
      setReplacements([]);
      setSelectedSegId(null);
      setEditingRepId(null);
      return;
    }
    setEditingRepId(null);
    void loadSegments(episodeId);
    void loadReplacements(episodeId);
  }, [episodeId, loadSegments, loadReplacements]);

  const selectedSeg = segments.find((s) => s.segment_id === selectedSegId) ?? null;
  const selectedChar = characters.find((c) => c.id === characterId) ?? null;

  useEffect(() => {
    if (editingRepId) return;
    if (!selectedSegId) return;
    const seg = segments.find((s) => s.segment_id === selectedSegId);
    if (seg) setReplacementText(seg.text);
  }, [selectedSegId, segments, editingRepId]);

  async function handleGenerate() {
    if (!episodeId || !selectedSegId || !characterId || !replacementText.trim()) {
      return;
    }
    if (!selectedChar?.default_voice_id) {
      setError("This character has no assigned voice. Set one in Voice Studio first.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      if (editingRepId) {
        const updated = await api.patchEpisodeReplacement(
          episodeId,
          editingRepId,
          {
            replacement_text: replacementText.trim(),
            tone_style: toneStyle.trim() || undefined,
            regenerate_audio: true,
          },
        );
        setReplacements((prev) =>
          prev.map((r) => (r.replacement_id === updated.replacement_id ? updated : r)),
        );
        setEditingRepId(null);
      } else {
        const created = await api.createSegmentReplacement(
          episodeId,
          selectedSegId,
          {
            character_id: characterId,
            replacement_text: replacementText.trim(),
            tone_style: toneStyle.trim() || undefined,
          },
        );
        setReplacements((prev) => [created, ...prev]);
      }
      toast("Replacement saved");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not generate replacement",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(rep: ReplacementDto) {
    if (!episodeId) return;
    if (!globalThis.confirm("Delete this replacement?")) return;
    setError(null);
    try {
      await api.deleteEpisodeReplacement(episodeId, rep.replacement_id);
      setReplacements((prev) =>
        prev.filter((r) => r.replacement_id !== rep.replacement_id),
      );
      if (editingRepId === rep.replacement_id) {
        setEditingRepId(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  function startEdit(rep: ReplacementDto) {
    setEditingRepId(rep.replacement_id);
    setSelectedSegId(rep.segment_id);
    setCharacterId(rep.character_id);
    setReplacementText(rep.replacement_text);
    setToneStyle(rep.tone_style ?? "");
  }

  const active = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Replace Lines"
        subtitle="Final mix step: pick a transcript line, pick the performing character, and generate new audio with the voice you attached in Voice Studio."
      />

      <Panel>
        <ol className="list-inside list-decimal space-y-1.5 text-sm leading-relaxed text-muted">
          <li>Open an episode that already has a transcript.</li>
          <li>Select the line to change.</li>
          <li>Choose which character should speak it.</li>
          <li>Edit the line if needed.</li>
          <li>Generate. Audio uses that character&apos;s voice.</li>
        </ol>
      </Panel>

      {error ? <ErrorBanner title="Replace lines" detail={error} /> : null}

      <Panel>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Project
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <select
            className="min-w-[220px] rounded-xl border border-white/[0.08] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
            value={activeProjectId ?? ""}
            disabled={projectsLoading || projects.length === 0}
            onChange={(e) => setActiveProjectId(e.target.value)}
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
        </div>
      </Panel>

      {!activeProjectId ? (
        <EmptyState
          icon={Clapperboard}
          title="Choose a project"
          description="Select a project to load episodes and transcript segments."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel>
            <h2 className="text-sm font-semibold text-text">Episode & segments</h2>
            <div className="mt-3">
              <label className="text-[11px] font-medium text-muted">Episode</label>
              <select
                className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                value={episodeId}
                disabled={epLoading}
                onChange={(e) => {
                  setEpisodeId(e.target.value);
                  setSelectedSegId(null);
                  setEditingRepId(null);
                }}
              >
                <option value="">Select episode</option>
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} ({e.segment_count} segments)
                  </option>
                ))}
              </select>
            </div>
            {segLoading ? (
              <Skeleton className="mt-4 h-40 w-full" />
            ) : episodeId && segments.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                No transcript segments yet.{" "}
                <Link href="/upload-match" className="text-accent hover:underline">
                  Import from Video
                </Link>{" "}
                to process a video, or pick another episode.
              </p>
            ) : (
              <ul className="mt-4 max-h-[360px] space-y-1 overflow-y-auto rounded-lg ring-1 ring-white/[0.06]">
                {segments.map((s) => {
                  const on = selectedSegId === s.segment_id;
                  return (
                    <li key={s.segment_id}>
                      <button
                        type="button"
                        className={`w-full px-3 py-2.5 text-left text-sm transition ${
                          on
                            ? "bg-accent/15 text-text"
                            : "hover:bg-white/[0.03] text-muted"
                        }`}
                        onClick={() => {
                          setSelectedSegId(s.segment_id);
                          setEditingRepId(null);
                        }}
                      >
                        <span className="font-mono text-[11px] text-muted">
                          {formatTime(s.start_time)} to {formatTime(s.end_time)}
                        </span>
                        {s.speaker_label ? (
                          <span className="ml-2 inline-block align-middle">
                            <Badge tone="default">{s.speaker_label}</Badge>
                          </span>
                        ) : null}
                        <p className="mt-1 line-clamp-2 text-text">{s.text}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <h2 className="text-sm font-semibold text-text">
              Replacement line
              {editingRepId ? (
                <span className="ml-2 text-xs font-normal text-accent">
                  (editing saved line)
                </span>
              ) : null}
            </h2>
            {!selectedSeg ? (
              <p className="mt-6 text-sm text-muted">
                Select a segment from the list to replace dialogue.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase text-muted">
                    Original
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-text">
                    {selectedSeg.text}
                  </p>
                  {selectedSeg.speaker_label ? (
                    <p className="mt-1 text-xs text-muted">
                      Speaker: {selectedSeg.speaker_label}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="text-[11px] font-semibold uppercase text-muted">
                    Character (project)
                  </label>
                  <select
                    className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                    value={characterId}
                    disabled={charLoading}
                    onChange={(e) => setCharacterId(e.target.value)}
                  >
                    <option value="">Choose character</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {!c.default_voice_id ? " (no voice)" : ""}
                      </option>
                    ))}
                  </select>
                  {selectedChar && !selectedChar.default_voice_id ? (
                    <p className="mt-2 text-xs text-amber-400">
                      This character has no assigned voice. Open Voice Studio to assign
                      a voice before generating.
                    </p>
                  ) : null}
                  {selectedChar && selectedChar.default_voice_id ? (
                    <p className="mt-1 text-xs text-muted">
                      Voice:{" "}
                      <span className="text-text">
                        {selectedChar.voice_display_name || selectedChar.default_voice_id}
                      </span>
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="text-[11px] font-semibold uppercase text-muted">
                    Replacement text
                  </label>
                  <textarea
                    className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                    rows={4}
                    value={replacementText}
                    onChange={(e) => setReplacementText(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold uppercase text-muted">
                    Tone / style hint (optional)
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                    value={toneStyle}
                    onChange={(e) => setToneStyle(e.target.value)}
                    placeholder="e.g. whisper, urgent, dry"
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Hints may behave differently depending on the active audio engine.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void handleGenerate()}
                    disabled={
                      generating ||
                      !episodeId ||
                      !characterId ||
                      !replacementText.trim() ||
                      !selectedChar?.default_voice_id
                    }
                  >
                    {generating ? (
                      <>
                        <Spinner className="h-4 w-4 border-t-canvas" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" />
                        {editingRepId ? "Regenerate" : "Generate replacement"}
                      </>
                    )}
                  </Button>
                  {editingRepId ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setEditingRepId(null);
                        if (selectedSeg) setReplacementText(selectedSeg.text);
                      }}
                    >
                      Cancel edit
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {activeProjectId && episodeId ? (
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">
              Saved replacements ({replacements.length})
            </h2>
            {repLoading ? (
              <Spinner className="h-4 w-4 border-t-accent" />
            ) : null}
          </div>
          {replacements.length === 0 && !repLoading ? (
            <p className="mt-3 text-sm text-muted">
              No replacements yet for this episode. Generate one above.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {replacements.map((r) => (
                <li
                  key={r.replacement_id}
                  className="rounded-xl bg-white/[0.02] p-4 ring-1 ring-white/[0.06]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono text-muted">
                        Segment {r.segment_id.slice(0, 12)}… · {r.character_name}
                      </p>
                      <p className="mt-1 text-sm text-text">
                        &ldquo;{r.replacement_text}&rdquo;
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
                        <span>Voice: {r.selected_voice_name}</span>
                        <Badge tone={r.fallback_used ? "default" : "success"}>
                          {r.fallback_used
                            ? "On-device speech"
                            : "Standard speech engine"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => startEdit(r)}
                      >
                        <Mic2 className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => void handleDelete(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                  <audio
                    controls
                    className="mt-3 w-full max-w-md"
                    src={mediaUrl(r.audio_url.replace(/^\/media\//, ""))}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

export default function ReplaceLinesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted">
          Loading…
        </div>
      }
    >
      <ReplaceLinesContent />
    </Suspense>
  );
}
