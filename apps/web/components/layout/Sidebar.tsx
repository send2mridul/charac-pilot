"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, FolderKanban, Sparkles } from "lucide-react";
import { APP_BRAND, secondaryNav, workflowNav } from "@/lib/nav";
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
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-foreground)]">
      <Link
        href="/projects"
        className="flex items-center gap-3 px-5 pb-5 pt-6"
      >
        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-surface shadow-glow ring-1 ring-[var(--sidebar-border)]">
          <Sparkles className="h-5 w-5 text-[var(--primary)]" aria-hidden />
        </div>
        <div>
          <div className="font-display text-lg font-semibold leading-none tracking-tight text-[var(--sidebar-accent-foreground)]">
            {APP_BRAND}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--sidebar-muted)]">
            Video → cast → voice → lines
          </div>
        </div>
      </Link>

      <div className="mx-5 h-px bg-[var(--sidebar-border)]" />

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <SectionLabel>Workflow</SectionLabel>
        <ul className="space-y-1">
          {workflowNav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href === "/projects"
                ? pathname.startsWith("/projects")
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            const primary = item.primary === true;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    primary
                      ? active
                        ? "bg-primary text-primary-foreground shadow-soft ring-1 ring-primary/30"
                        : "bg-primary/12 text-[var(--sidebar-foreground)] ring-1 ring-primary/25 hover:bg-primary/20"
                      : active
                        ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] shadow-soft"
                        : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--sidebar-accent-foreground)]"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                      primary
                        ? active
                          ? "bg-primary-foreground/15 text-primary-foreground"
                          : "bg-primary/20 text-primary"
                        : active
                          ? "bg-primary/15 text-primary"
                          : "bg-[var(--sidebar-accent)]/40 text-[var(--sidebar-muted)] group-hover:text-[var(--sidebar-accent-foreground)]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                  </span>
                  <span
                    className={`flex-1 text-left tracking-tight ${primary ? "font-semibold" : ""}`}
                  >
                    {item.label}
                  </span>
                  {active ? (
                    <ChevronRight
                      className={`h-4 w-4 ${primary ? "text-primary-foreground/80" : "text-[var(--sidebar-muted)]"}`}
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        {secondaryNav.length > 0 ? (
          <>
            <SectionLabel>Helpers</SectionLabel>
            <ul className="space-y-1">
              {secondaryNav.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                        active
                          ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]"
                          : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--sidebar-accent-foreground)]"
                      }`}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--sidebar-accent)]/40 text-[var(--sidebar-muted)]">
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      </span>
                      <span className="flex-1 leading-snug">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        <SectionLabel>Projects</SectionLabel>
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--sidebar-muted)]">
            <Spinner className="h-4 w-4" />
            Loading…
          </div>
        ) : projects.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[var(--sidebar-muted)]">
            No projects yet. Create one from the Projects page.
          </p>
        ) : (
          <ul className="space-y-1">
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
                        ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]"
                        : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--sidebar-accent-foreground)]"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isContext
                          ? "bg-primary/20 text-primary"
                          : "bg-[var(--sidebar-accent)]/40 text-[var(--sidebar-muted)]"
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

      <div className="m-4 rounded-2xl border border-[var(--sidebar-border)] bg-[var(--sidebar-accent)]/40 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <span className="text-xs font-bold">L</span>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[var(--sidebar-accent-foreground)]">
              Local workspace
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--sidebar-muted)]">
              Projects and media stay on this machine. Keep the API running for full workflow.
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function BadgePill({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary ring-1 ring-primary/30">
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sidebar-muted)]">
      {children}
    </p>
  );
}
