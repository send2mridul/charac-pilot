"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
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

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-8 py-4 backdrop-blur-md lg:px-12">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <nav className="flex items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {APP_BRAND}
          </span>
          <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
          <span className="font-semibold text-foreground">{title}</span>
        </nav>

        <div className="flex items-center gap-3 rounded-full border border-border bg-surface px-3 py-1.5 shadow-soft">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-ink-foreground">
            CV
          </div>
          <div className="hidden text-left leading-tight sm:block">
            <p className="text-xs font-semibold text-foreground">You</p>
            <p className="text-[10px] text-muted-foreground">Workspace</p>
          </div>
        </div>
      </div>
    </header>
  );
}
