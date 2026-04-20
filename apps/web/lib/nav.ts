import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Clapperboard,
  FileDown,
  LayoutDashboard,
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

export const mainNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: Clapperboard },
  { href: "/character-bible", label: "Character Bible", icon: BookOpen },
  { href: "/voice-studio", label: "Voice Studio", icon: Mic2 },
  { href: "/upload-match", label: "New Upload / Match", icon: Upload },
  { href: "/scene-replace", label: "Scene Replace", icon: Shuffle },
  { href: "/continuity-check", label: "Continuity Check", icon: ScanSearch },
  { href: "/export", label: "Export", icon: FileDown },
];

export function navTitleForPath(pathname: string): string {
  const hit = mainNav.find(
    (n) =>
      n.href === pathname ||
      (n.href !== "/dashboard" && pathname.startsWith(`${n.href}/`)),
  );
  if (hit) return hit.label;
  if (pathname.startsWith("/projects/")) return "Project";
  return "CharacPilot";
}
