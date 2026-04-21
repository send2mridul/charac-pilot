import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Clapperboard,
  Mic2,
  Shuffle,
  Upload,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown larger / primary in the sidebar (sellable entry). */
  primary?: boolean;
};

/** Core workflow: project, import, cast, voices, replace. */
export const workflowNav: NavItem[] = [
  { href: "/projects", label: "Projects", icon: Clapperboard },
  { href: "/characters", label: "Characters", icon: BookOpen },
  { href: "/voice-studio", label: "Voice Studio", icon: Mic2 },
  { href: "/replace-lines", label: "Replace Lines", icon: Shuffle },
  { href: "/upload-match", label: "Import from Video", icon: Upload, primary: true },
];

/** Legacy: secondary nav was a separate list; kept empty for compatibility. */
export const secondaryNav: NavItem[] = [];

/** Deprecated: Continuity and Export are not part of the core story (hidden from nav). */
export const comingSoonNav: NavItem[] = [];

const allNav = [...workflowNav, ...secondaryNav, ...comingSoonNav];

export function navTitleForPath(pathname: string): string {
  if (pathname.startsWith("/projects/")) return "Project";
  if (pathname === "/projects") return "Projects";
  const hit = allNav.find(
    (n) =>
      n.href === pathname ||
      (n.href !== "/projects" && pathname.startsWith(`${n.href}/`)),
  );
  if (hit) return hit.label;
  if (pathname === "/dashboard") return "Projects";
  if (pathname === "/character-bible") return "Characters";
  if (pathname === "/replace-lines" || pathname === "/scene-replace") {
    return "Replace Lines";
  }
  return "CastVoice";
}

export const APP_BRAND = "CastVoice";
