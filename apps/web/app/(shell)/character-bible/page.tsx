"use client";

import { useEffect, useState } from "react";
import { BookOpen, ImageIcon, Mic2, Volume2 } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto } from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";

export default function CharacterBiblePage() {
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    loading: projectsLoading,
  } = useProjects();
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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
          setError(
            e instanceof ApiError ? e : new ApiError("Request failed", 0, ""),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const active = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Character Bible"
        subtitle="Saved characters from speaker diarization and manual creation — scoped to the active project."
        actions={
          <>
            <Button variant="secondary">Import references</Button>
            <Button>Add character</Button>
          </>
        }
      />

      <Panel>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Active project
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <select
            className="min-w-[200px] rounded-xl border border-white/[0.08] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
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
          {active ? (
            <span className="text-xs text-muted">
              {active.scene_count} scenes tracked
            </span>
          ) : null}
        </div>
      </Panel>

      {error ? (
        <ErrorBanner
          title="Could not load characters"
          detail={error.message}
        />
      ) : null}

      {projectsLoading || loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <Skeleton className="h-40 w-full" />
          </Panel>
          <Panel>
            <Skeleton className="h-40 w-full" />
          </Panel>
        </div>
      ) : !activeProjectId ? (
        <EmptyState
          icon={BookOpen}
          title="Pick a project"
          description="Create a project first, then choose it above to load characters."
        />
      ) : characters.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No characters yet"
          description="Upload a video in Upload / Match, then create characters from speaker groups."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {characters.map((c) => (
            <Panel key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-text">{c.name}</h2>
                  <p className="text-sm text-muted">
                    {c.role || "No role assigned"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {c.is_narrator ? (
                    <Badge tone="violet">Narrator</Badge>
                  ) : null}
                  {c.source_episode_id ? (
                    <Badge tone="accent">From diarization</Badge>
                  ) : (
                    <Badge tone="default">Seed</Badge>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-4 text-sm">
                {c.source_speaker_labels.length > 0 ? (
                  <div className="flex flex-wrap gap-4 text-xs text-muted">
                    <span>
                      <Mic2 className="mr-1 inline h-3 w-3" />
                      {c.source_speaker_labels.join(", ")}
                    </span>
                    <span>{c.segment_count} segments</span>
                    <span>{c.total_speaking_duration.toFixed(1)}s speaking</span>
                  </div>
                ) : null}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Voice
                  </p>
                  {c.default_voice_id ? (
                    <div className="mt-1 flex items-center gap-2">
                      <Volume2 className="h-3.5 w-3.5 text-green-400" />
                      <span className="text-xs font-medium text-text">
                        {c.voice_display_name || c.default_voice_id}
                      </span>
                      {c.voice_provider ? (
                        <Badge tone="success">{c.voice_provider}</Badge>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted/60">
                      No voice assigned
                    </p>
                  )}
                  <Link
                    href="/voice-studio"
                    className="mt-2 inline-block text-[11px] font-medium text-accent hover:underline"
                  >
                    {c.default_voice_id ? "Change in Voice Studio →" : "Assign in Voice Studio →"}
                  </Link>
                </div>

                {c.sample_texts.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Sample lines
                    </p>
                    <div className="mt-1 space-y-1">
                      {c.sample_texts.map((t, i) => (
                        <p
                          key={i}
                          className="truncate text-xs italic text-muted"
                        >
                          &ldquo;{t}&rdquo;
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {c.traits.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Traits
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {c.traits.map((t) => (
                        <li key={t}>
                          <Badge tone="accent">{t}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {c.wardrobe_notes ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Wardrobe
                    </p>
                    <p className="mt-2 leading-relaxed text-muted">
                      {c.wardrobe_notes}
                    </p>
                  </div>
                ) : null}

                {c.continuity_rules.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Continuity rules
                    </p>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
                      {c.continuity_rules.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
