"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutGrid,
  Workflow,
  Mic2,
  LogOut,
  Settings,
  CreditCard,
} from "lucide-react";
import { useHydrated } from "@/lib/useHydrated";
import { SidebarSkeleton } from "@/components/layout/SidebarSkeleton";

const items = [
  { href: "/projects", label: "Projects", icon: LayoutGrid, exact: true },
  { href: "/upload-match", label: "Workspace", icon: Workflow },
  { href: "/voice-studio", label: "Voices", icon: Mic2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  if (!hydrated) return <SidebarSkeleton />;

  const user = session?.user;
  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "CW";

  return (
    <aside className="w-[64px] shrink-0 bg-canvas border-r border-border flex flex-col items-center py-4 gap-1">
      <Link
        href="/projects"
        className="size-9 rounded-lg bg-foreground text-surface flex items-center justify-center font-bold mb-3"
        title="CastWeave home"
      >
        C
      </Link>

      <nav className="flex flex-col gap-1.5 flex-1">
        {items.map((it) => {
          const active = it.exact
            ? pathname === it.href || pathname.startsWith("/projects/")
            : pathname === it.href || pathname.startsWith(`${it.href}/`);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`size-10 rounded-lg flex items-center justify-center transition-colors group relative ${
                active
                  ? "bg-surface border border-border text-foreground shadow-xs"
                  : "text-foreground-subtle hover:text-foreground hover:bg-surface"
              }`}
              title={it.label}
            >
              <Icon className="size-[18px]" />
              <span className="absolute left-full ml-2 px-2 py-1 rounded bg-foreground text-surface text-[11px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                {it.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1.5 items-center relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="size-9 rounded-full overflow-hidden flex items-center justify-center text-[12px] font-bold mt-1 hover:ring-2 hover:ring-border transition-all bg-amber-100 text-amber-800"
          title={user?.name ?? "Account"}
        >
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="size-full object-cover" />
          ) : (
            initials
          )}
        </button>

        {menuOpen && (
          <div className="absolute bottom-full left-full mb-1 ml-1 w-48 rounded-lg border border-border bg-surface shadow-md py-1 z-50">
            {user && (
              <div className="px-3 py-2 border-b border-border">
                <div className="text-[12px] font-semibold truncate">{user.name}</div>
                <div className="text-[11px] text-foreground-muted truncate">{user.email}</div>
              </div>
            )}
            <Link
              href="/account"
              onClick={() => setMenuOpen(false)}
              className="w-full text-left px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-canvas flex items-center gap-2 transition-colors"
            >
              <Settings className="size-3.5" />
              Account & billing
            </Link>
            <Link
              href="/pricing"
              onClick={() => setMenuOpen(false)}
              className="w-full text-left px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-canvas flex items-center gap-2 transition-colors"
            >
              <CreditCard className="size-3.5" />
              Pricing
            </Link>
            <button
              onClick={() => void signOut({ callbackUrl: "/sign-in" })}
              className="w-full text-left px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-canvas flex items-center gap-2 transition-colors border-t border-border"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
