"use client";

import { usePathname } from "next/navigation";
import { APP_BRAND, navTitleForPath } from "@/lib/nav";
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
    ? "Characters, voices, and episodes for this production."
    : "Create a project, add characters, attach voices, replace lines.";

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/[0.06] bg-canvas/80 px-6 py-4 backdrop-blur-md">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          {APP_BRAND}
        </p>
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-[11px] text-muted/90">{subtitle}</p>
      </div>

      <div className="flex flex-1 items-center justify-end">
        <div className="flex items-center gap-2 rounded-xl bg-panel/90 py-1 pl-1 pr-3 ring-1 ring-white/10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet/40 to-accent/30 text-[10px] font-bold text-text">
            CV
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-xs font-medium text-text">You</p>
            <p className="text-[10px] text-muted">Workspace</p>
          </div>
        </div>
      </div>
    </header>
  );
}
