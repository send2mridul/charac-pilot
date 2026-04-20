import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Clapperboard,
  FileDown,
  Mic2,
  ScanSearch,
  Shuffle,
  Upload,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Core workflow: project → characters → voices → replace. */
export const workflowNav: NavItem[] = [
  { href: "/projects", label: "Projects", icon: Clapperboard },
  { href: "/characters", label: "Characters", icon: BookOpen },
  { href: "/voice-studio", label: "Voice Studio", icon: Mic2 },
  { href: "/replace-lines", label: "Replace Lines", icon: Shuffle },
];

/** Optional helper (not a separate product pillar). */
export const secondaryNav: NavItem[] = [
  { href: "/upload-match", label: "Import from Video", icon: Upload },
];

export const comingSoonNav: NavItem[] = [
  { href: "/continuity-check", label: "Continuity", icon: ScanSearch },
  { href: "/export", label: "Export", icon: FileDown },
];

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
