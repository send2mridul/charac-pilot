"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, FolderKanban, Sparkles } from "lucide-react";
import {
  APP_BRAND,
  comingSoonNav,
  secondaryNav,
  workflowNav,
} from "@/lib/nav";
import { useHydrated } from "@/lib/useHydrated";
import { useProjects } from "@/components/providers/ProjectProvider";
import { SidebarSkeleton } from "@/components/layout/SidebarSkeleton";
import { Spinner } from "@/components/ui/Spinner";

export function Sidebar() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const { projects, loading, activeProjectId, setActiveProjectId } =
    useProjects();

  if (!hydrated) {
    return <SidebarSkeleton />;
  }

  return (
    <aside className="relative flex h-full w-64 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
        <div className="flex size-7 items-center justify-center rounded-md bg-text text-canvas">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </div>
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold tracking-tight text-text">
            {APP_BRAND}
          </p>
          <p className="text-[11px] text-muted">Cast your voices</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-2 pb-2 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted/70">
          Workflow
        </p>
        <ul className="space-y-0.5">
          {workflowNav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href === "/projects"
                ? pathname.startsWith("/projects")
                : pathname === item.href || pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group relative flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition ${
                    active
                      ? "border-border bg-panel-elevated text-text shadow-[0_1px_2px_rgba(17,24,39,0.08)]"
                      : "border-transparent text-muted hover:border-border hover:bg-panel-elevated hover:text-text"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-md ${
                      active
                        ? "bg-accent-dim text-accent"
                        : "bg-panel-elevated text-muted group-hover:text-text"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="flex-1 font-medium">{item.label}</span>
                  {active ? <ChevronRight className="h-4 w-4 text-accent/80" /> : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 px-2 pb-2 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted/70">
          Helpers
        </p>
        <ul className="space-y-0.5">
          {secondaryNav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition ${
                    active
                      ? "border-border bg-panel-elevated text-text"
                      : "border-transparent text-muted hover:border-border hover:bg-panel-elevated hover:text-text"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                  <span className="flex-1 leading-snug">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-5 px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted/60">
          Coming soon
        </p>
        <ul className="space-y-0.5 opacity-80">
          {comingSoonNav.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-[12px] text-muted/80 transition hover:border-border hover:bg-panel-elevated hover:text-muted"
                >
                  <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span className="flex-1 leading-snug">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 px-2 pb-2 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted/70">
          Projects
        </p>
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted">
            <Spinner className="h-4 w-4" />
            Loading…
          </div>
        ) : projects.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">
            No projects yet. Create one from the Projects page.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {projects.slice(0, 6).map((p) => {
              const href = `/projects/${p.id}`;
              const active = pathname === href;
              const isContext = activeProjectId === p.id;
              return (
                <li key={p.id}>
                  <Link
                    href={href}
                    onClick={() => setActiveProjectId(p.id)}
                    className={`flex items-center gap-3 rounded-lg border px-2.5 py-2 text-sm transition ${
                      active
                        ? "border-border bg-panel-elevated text-text"
                        : "border-transparent text-muted hover:border-border hover:bg-panel-elevated hover:text-text"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-md ${
                        isContext
                          ? "bg-violet-dim text-violet"
                          : "bg-panel-elevated text-muted"
                      }`}
                    >
                      <FolderKanban className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    {isContext ? <BadgePill>Active</BadgePill> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-border p-4">
        <PanelMini />
      </div>
    </aside>
  );
}

function BadgePill({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-panel-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-border">
      {children}
    </span>
  );
}

function PanelMini() {
  return (
    <div className="rounded-xl border border-border bg-panel-elevated p-3">
      <p className="text-xs font-medium text-text">Local workspace</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Projects and media stay on this machine. Keep the API running to use
        the full workflow.
      </p>
    </div>
  );
}
