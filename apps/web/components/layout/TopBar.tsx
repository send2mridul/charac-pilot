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
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-canvas/85 px-8 py-3 backdrop-blur-xl lg:px-12">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          {APP_BRAND}
        </p>
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-[12px] text-muted">{subtitle}</p>
      </div>

      <div className="flex flex-1 items-center justify-end">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-2 py-1 shadow-[0_1px_2px_rgba(17,24,39,0.08)]">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-text to-text/80 text-[10px] font-bold text-canvas">
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
