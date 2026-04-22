"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Film,
  FolderKanban,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";

const accentBar = {
  teal: "from-[oklch(0.62_0.13_185)] to-[oklch(0.5_0.12_200)]",
  amber: "from-[oklch(0.78_0.14_70)] to-[oklch(0.65_0.15_45)]",
  violet: "from-[oklch(0.6_0.15_290)] to-[oklch(0.45_0.13_270)]",
} as const;

type Accent = keyof typeof accentBar;

function accentForIndex(i: number): Accent {
  const keys: Accent[] = ["teal", "amber", "violet"];
  return keys[i % keys.length]!;
}

function formatUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

type ProjStats = { total: number; voiced: number };

function setupHint(s: ProjStats | undefined): string {
  if (!s || s.total === 0) {
    return "Import video or add cast";
  }
  if (s.voiced === 0) {
    return `${s.total} in cast · need voices`;
  }
  if (s.voiced < s.total) {
    return `Voices ${s.voiced}/${s.total}`;
  }
  return "Ready for Replace Lines";
}

function StatusPill({ status }: { status: string }) {
  const st = status.toLowerCase();
  const map =
    st === "active"
      ? "bg-primary/12 text-primary ring-primary/25"
      : st === "archived"
        ? "bg-muted text-muted-foreground ring-border"
        : "bg-surface-sunken text-muted-foreground ring-border-strong";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ring-1 ring-inset ${map}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const { projects, loading, error, refresh, setActiveProjectId } = useProjects();
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [statsByProject, setStatsByProject] = useState<Record<string, ProjStats>>(
    {},
  );
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (projects.length === 0) {
      setStatsByProject({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      projects.map(async (p) => {
        try {
          const chars = await api.listCharacters(p.id);
          const voiced = chars.filter((c) => c.default_voice_id).length;
          return [p.id, { total: chars.length, voiced }] as const;
        } catch {
          return [p.id, { total: 0, voiced: 0 }] as const;
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, ProjStats> = {};
      for (const [id, s] of rows) next[id] = s;
      setStatsByProject(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    if (!openMenuProjectId) return;
    function onPointerDown(ev: MouseEvent) {
      const el = (ev.target as HTMLElement | null)?.closest?.(
        "[data-project-menu-root]",
      );
      if (el) return;
      setOpenMenuProjectId(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openMenuProjectId]);

  async function onCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const p = await api.createProject({
        name: newName.trim(),
        lead: "You",
        description: newDesc.trim(),
      });
      setActiveProjectId(p.id);
      await refresh();
      setModalOpen(false);
      setNewName("");
      setNewDesc("");
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setCreateError(
        e instanceof ApiError ? e.message : "Could not create project",
      );
    } finally {
      setCreating(false);
    }
  }

  async function onDeleteProject(projectId: string, projectName: string) {
    if (
      !globalThis.confirm(
        `Delete “${projectName}” and all of its characters, episodes, and metadata on this machine?`,
      )
    ) {
      return;
    }
    setDeletingProjectId(projectId);
    setOpenMenuProjectId(null);
    try {
      await api.deleteProject(projectId);
      await refresh();
      router.push("/projects");
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingProjectId(null);
    }
  }

  const activeCount = projects.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6 pb-2">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {projects.length} project · {activeCount} active
          </span>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-balance text-foreground md:text-6xl">
            Projects
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Open a project to run the workflow: import video, roster your cast in Characters, attach voices, then replace lines.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-ink-foreground shadow-lifted transition hover:bg-foreground"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          New project
        </button>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-project-title"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-lifted">
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 id="new-project-title" className="font-display text-lg font-semibold text-foreground">
              New project
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Name your production. Description is optional.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Project name</label>
                <input
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Neon Alley, Season 2"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Description (optional)</label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-border bg-surface-sunken/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Short note for your future self"
                />
              </div>
            </div>
            {createError ? (
              <p className="mt-3 text-xs text-red-600">{createError}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={creating || !newName.trim()}
                onClick={() => void onCreate()}
              >
                {creating ? (
                  <Spinner className="h-4 w-4 border-t-primary-foreground" />
                ) : null}
                Create and open
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <ErrorBanner
          title="Could not load projects"
          detail={`${error.message}. Is the API running on port 8000?`}
          onRetry={() => void refresh()}
        />
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-soft">
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project first. Inside the project you can import video or add characters manually."
          action={
            <Button type="button" onClick={() => setModalOpen(true)}>
              New project
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex items-end justify-between pb-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                All projects
              </div>
              <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">
                Your workspace
              </h2>
            </div>
            <div className="hidden text-xs text-muted-foreground md:block">
              Sorted by <span className="font-mono font-semibold text-foreground">last updated</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p, i) => {
              const accent = accentForIndex(i);
              const hint = setupHint(statsByProject[p.id]);
              return (
                <article
                  key={p.id}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-all hover:-translate-y-1 hover:border-border-strong hover:shadow-lifted"
                >
                  <div className={`h-2 w-full bg-gradient-to-r ${accentBar[accent]}`} />
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-soft ${accentBar[accent]}`}
                        >
                          <Film className="h-4 w-4" strokeWidth={2.5} />
                        </div>
                        <div>
                          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight text-foreground">
                            {p.name}
                          </h3>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            Updated {formatUpdated(p.updated_at)}
                          </div>
                        </div>
                      </div>
                      <div
                        className="relative z-20 shrink-0"
                        data-project-menu-root
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-sunken hover:text-foreground aria-expanded:ring-2 aria-expanded:ring-primary/25"
                          aria-label="Project actions"
                          aria-expanded={openMenuProjectId === p.id}
                          aria-haspopup="menu"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenMenuProjectId((id) =>
                              id === p.id ? null : p.id,
                            );
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMenuProjectId === p.id ? (
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-xl border border-border bg-surface py-1 shadow-lifted"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-sunken"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuProjectId(null);
                                setActiveProjectId(p.id);
                                router.push(`/projects/${p.id}`);
                              }}
                            >
                              Open project
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={deletingProjectId === p.id}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                void onDeleteProject(p.id, p.name);
                              }}
                            >
                              {deletingProjectId === p.id ? (
                                <Spinner className="h-4 w-4 border-t-red-600" />
                              ) : null}
                              Delete project
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <StatusPill status={p.status} />
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                        {hint}
                      </span>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-5">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Characters
                        </div>
                        <div className="mt-1 font-mono text-xl font-semibold text-foreground">
                          {statsByProject[p.id]?.total ?? "…"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Voices assigned
                        </div>
                        <div className="mt-1 font-mono text-xl font-semibold text-foreground">
                          {statsByProject[p.id]
                            ? `${statsByProject[p.id]!.voiced}/${statsByProject[p.id]!.total}`
                            : "…"}
                        </div>
                      </div>
                    </div>

                    <Link
                      href={`/projects/${p.id}`}
                      onClick={() => setActiveProjectId(p.id)}
                      className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
                    >
                      Open project
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </article>
              );
            })}

            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="group flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface-sunken/40 p-6 text-center transition-all hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </span>
              <div>
                <div className="font-display text-base font-semibold text-foreground">New project</div>
                <div className="mt-1 text-xs text-muted-foreground">Start a fresh canvas</div>
              </div>
            </button>
          </div>
        </>
      )}

      <footer className="mt-16 border-t border-border pt-6 text-center text-[11px] text-muted-foreground">
        CastWeave · Video to cast, voice, and lines.
      </footer>
    </div>
  );
}
