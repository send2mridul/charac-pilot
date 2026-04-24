"use client";

import Link from "next/link";
import { ChevronLeft, Mic2, Video, ChevronDown, Upload, Download, MoreHorizontal, Share2 } from "lucide-react";

interface Props {
  projectName: string;
  episodeTitle: string;
  sourceKind: "video" | "audio";
  duration?: string;
  size?: string;
  onImport?: () => void;
  onExport?: () => void;
}

export function WorkspaceHeader({ projectName, episodeTitle, sourceKind, duration, size, onImport, onExport }: Props) {
  return (
    <header className="h-[60px] shrink-0 bg-surface border-b border-border flex items-center px-8 gap-5">
      <Link href="/projects" className="size-8 rounded-md hover:bg-canvas flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors -ml-1" title="Back to Projects">
        <ChevronLeft className="size-4" />
      </Link>

      <nav className="flex items-center gap-2 text-[13px] min-w-0">
        <Link href="/projects" className="text-foreground-muted hover:text-foreground transition-colors font-medium">{projectName}</Link>
        <span className="text-border">/</span>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-canvas text-foreground font-semibold text-[13px] transition-colors">
          {sourceKind === "audio" ? <Mic2 className="size-3.5 text-foreground-muted" /> : <Video className="size-3.5 text-foreground-muted" />}
          {episodeTitle}
        </span>
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-3 text-[12px] text-foreground-muted num font-medium">
        {duration && <span>{duration}</span>}
        {size && (<><span className="text-border">&middot;</span><span>{size}</span></>)}
      </div>

      <div className="h-6 w-px bg-border" />

      <div className="flex items-center gap-1.5">
        {onExport && (
          <button onClick={onExport} className="h-9 px-3 rounded-md text-[13px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas transition-colors flex items-center gap-1.5">
            <Download className="size-3.5" /> Export
          </button>
        )}
        {onImport && (
          <button onClick={onImport} className="h-9 px-3.5 rounded-md text-[13px] font-bold bg-foreground text-surface hover:bg-foreground/90 transition-colors flex items-center gap-1.5 shadow-xs">
            <Upload className="size-3.5" /> Import media
          </button>
        )}
      </div>
    </header>
  );
}

interface EpisodeTab {
  id: string;
  name: string;
  type: "video" | "audio";
  lines: number;
  active?: boolean;
}

export function EpisodeTabs({ episodes, onSelect }: { episodes: EpisodeTab[]; onSelect?: (id: string) => void }) {
  return (
    <div className="h-10 shrink-0 bg-canvas border-b border-border flex items-center px-8 gap-1">
      <span className="label-section mr-3">Episodes</span>
      {episodes.map((ep) => (
        <button
          key={ep.id}
          onClick={() => onSelect?.(ep.id)}
          className={`h-7 px-3 rounded-md flex items-center gap-2 text-[12.5px] font-medium transition-colors ${
            ep.active
              ? "bg-surface border border-border shadow-xs text-foreground"
              : "text-foreground-muted hover:text-foreground hover:bg-surface/60"
          }`}
        >
          {ep.type === "audio" ? <Mic2 className="size-3" /> : <Video className="size-3" />}
          <span>{ep.name}</span>
          <span className="text-[10.5px] num text-foreground-subtle">{ep.lines}</span>
        </button>
      ))}
    </div>
  );
}
