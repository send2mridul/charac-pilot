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
    <aside className="relative flex h-full w-64 shrink-0 flex-col border-r border-white/[0.08] bg-panel/90 backdrop-blur-md before:pointer-events-none before:absolute before:inset-y-8 before:left-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-accent/50 before:to-transparent">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent/30 to-violet/30 ring-1 ring-white/10">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-text">
            {APP_BRAND}
          </p>
          <p className="text-[11px] text-muted">Cast your voices</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted/80">
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
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                    active
                      ? "bg-white/[0.07] text-text ring-1 ring-white/10 before:absolute before:left-0 before:top-1/2 before:h-8 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-accent before:shadow-[0_0_16px_rgba(94,234,212,0.45)]"
                      : "text-muted hover:bg-white/[0.04] hover:text-text"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      active
                        ? "bg-accent-dim text-accent"
                        : "bg-white/[0.04] text-muted group-hover:text-text"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="flex-1 font-medium">{item.label}</span>
                  {active ? (
                    <ChevronRight className="h-4 w-4 text-accent/80" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted/80">
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
                  className={`group flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition ${
                    active
                      ? "bg-white/[0.06] text-text"
                      : "text-muted/90 hover:bg-white/[0.04] hover:text-text"
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
                  className="group flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[12px] text-muted/80 transition hover:bg-white/[0.03] hover:text-muted"
                >
                  <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span className="flex-1 leading-snug">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted/80">
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
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                      active
                        ? "bg-white/[0.07] text-text ring-1 ring-white/10"
                        : "text-muted hover:bg-white/[0.04] hover:text-text"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isContext
                          ? "bg-violet-dim text-violet"
                          : "bg-white/[0.04] text-muted"
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

      <div className="border-t border-white/[0.06] p-4">
        <PanelMini />
      </div>
    </aside>
  );
}

function BadgePill({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-white/10">
      {children}
    </span>
  );
}

function PanelMini() {
  return (
    <div className="rounded-xl bg-gradient-to-br from-panel-elevated to-panel p-3 ring-1 ring-white/10">
      <p className="text-xs font-medium text-text">Local workspace</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Projects and media stay on this machine. Keep the API running to use
        the full workflow.
      </p>
    </div>
  );
}
