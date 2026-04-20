"use client";

import { Bell, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { navTitleForPath } from "@/lib/nav";
import { useHydrated } from "@/lib/useHydrated";
import { useProjects } from "@/components/providers/ProjectProvider";
import { TopBarSkeleton } from "@/components/layout/TopBarSkeleton";

export function TopBar() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const { projects } = useProjects();

  if (!hydrated) {
    return <TopBarSkeleton />;
  }

  const detail = /^\/projects\/([^/]+)$/.exec(pathname);
  const projectId = detail?.[1];
  const project =
    projectId && projectId !== "projects"
      ? projects.find((p) => p.id === projectId)
      : null;

  const title = project?.name ?? navTitleForPath(pathname);
  const subtitle = project
    ? "Project overview · episodes & continuity"
    : "Continuity cockpit";

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/[0.06] bg-canvas/80 px-6 py-4 backdrop-blur-md">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          CharacPilot
        </p>
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-[11px] text-muted/90">{subtitle}</p>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <label className="relative hidden max-w-md flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search shots, characters, lines…"
            className="w-full rounded-xl border border-white/[0.08] bg-panel/80 py-2.5 pl-10 pr-3 text-sm text-text placeholder:text-muted/70 outline-none ring-0 transition focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <button
          type="button"
          className="relative rounded-xl p-2 text-muted ring-1 ring-white/10 transition hover:bg-white/[0.05] hover:text-text"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_rgba(94,234,212,0.8)]" />
        </button>
        <div className="flex items-center gap-2 rounded-xl bg-panel/90 py-1 pl-1 pr-3 ring-1 ring-white/10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet/40 to-accent/30 text-xs font-bold text-text">
            CP
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-xs font-medium text-text">You</p>
            <p className="text-[10px] text-muted">Owner</p>
          </div>
        </div>
      </div>
    </header>
  );
}
