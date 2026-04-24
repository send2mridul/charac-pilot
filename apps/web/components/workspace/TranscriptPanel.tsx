"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  Loader2,
  Play,
  Search,
  Sparkles,
  Save,
} from "lucide-react";

export type LineState = "ready" | "generated" | "blocked" | "needs-character" | "needs-voice";

export interface TranscriptLine {
  id: string;
  lineNum: number;
  timeCode: string;
  characterName: string;
  text: string;
  state: LineState;
  stateReason?: string;
  isActive?: boolean;
  generatedAudio?: string | null;
  characterColor: string;
}

interface Props {
  lines: TranscriptLine[];
  onSelect: (id: string) => void;
  onGenerateReady: () => void;
  onPlayLine?: (lineId: string) => void;
  canGenerate: boolean;
  generating: boolean;
  readyCount: number;
  totalLines: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  generatedCount: number;
  blockedCount: number;
  onSaveAllText?: () => void;
  savingText?: boolean;
}

function StateBadge({ state }: { state: LineState }) {
  switch (state) {
    case "generated":
      return <span className="flex items-center gap-1 text-[10.5px] font-semibold text-success"><CheckCircle2 className="size-3" />Generated</span>;
    case "ready":
      return <span className="flex items-center gap-1 text-[10.5px] font-semibold text-accent"><Sparkles className="size-3" />Ready</span>;
    case "needs-voice":
      return <span className="flex items-center gap-1 text-[10.5px] font-semibold text-warning-foreground"><AlertCircle className="size-3" />Needs voice</span>;
    case "needs-character":
      return <span className="flex items-center gap-1 text-[10.5px] font-semibold text-foreground-subtle"><AlertCircle className="size-3" />Needs character</span>;
    case "blocked":
      return <span className="flex items-center gap-1 text-[10.5px] font-semibold text-foreground-subtle"><AlertCircle className="size-3" />Blocked</span>;
  }
}

export function TranscriptPanel({
  lines,
  onSelect,
  onGenerateReady,
  onPlayLine,
  canGenerate,
  generating,
  readyCount,
  totalLines,
  searchQuery,
  onSearchChange,
  generatedCount,
  blockedCount,
  onSaveAllText,
  savingText,
}: Props) {
  const [filter, setFilter] = useState<"all" | LineState>("all");
  const filtered = filter === "all" ? lines : lines.filter(l => l.state === filter);

  return (
    <section className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Toolbar */}
      <div className="h-14 shrink-0 border-b border-border bg-surface flex items-center px-5 gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="size-3.5 text-foreground-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search lines"
            className="h-8 w-full pl-8 pr-3 text-[12.5px] bg-canvas border border-border rounded-md focus:outline-none focus:border-border-strong"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(["all", "ready", "generated", "blocked"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${
                filter === f ? "bg-foreground text-surface shadow-xs" : "text-foreground-muted hover:text-foreground hover:bg-canvas"
              }`}
            >
              {f === "all" ? "All" : f === "ready" ? "Ready" : f === "generated" ? "Generated" : "Blocked"}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-4 text-[11.5px] text-foreground-subtle num font-medium">
          <span className="text-success">{generatedCount} generated</span>
          <span className="text-accent">{readyCount} ready</span>
          {blockedCount > 0 && <span className="text-warning-foreground">{blockedCount} blocked</span>}
        </div>

        <div className="h-5 w-px bg-border" />

        {onSaveAllText && (
          <button
            onClick={onSaveAllText}
            disabled={savingText}
            className="h-8 px-3 rounded-md text-[12px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas border border-border transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="size-3.5" /> Save text
          </button>
        )}

        <button
          onClick={onGenerateReady}
          disabled={!canGenerate || generating}
          className="h-8 px-3.5 rounded-md text-[12.5px] font-bold bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {generating ? "Generating..." : `Generate ${readyCount} ready`}
        </button>
      </div>

      {/* Blocked banner */}
      {blockedCount > 0 && (
        <div className="mx-5 mt-3 mb-1 px-4 py-3 bg-warning-soft border border-warning-border rounded-lg text-[12.5px]">
          <div className="flex items-center gap-2 font-semibold text-warning-foreground">
            <AlertCircle className="size-4 shrink-0" />
            {blockedCount} line{blockedCount !== 1 ? "s" : ""} cannot be generated
          </div>
          <p className="text-[11.5px] text-warning-foreground/80 mt-1 ml-6">Attach a voice or create a character first, then the lines unlock.</p>
        </div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-foreground-muted gap-2 py-16">
            <Filter className="size-6 text-border-strong" />
            <div className="text-[13px] font-semibold">{lines.length === 0 ? "No lines yet" : "No matches"}</div>
            <div className="text-[12px] text-foreground-subtle max-w-xs">{lines.length === 0 ? "Import a media file to start working with transcript lines." : "Try a different filter or search term."}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((l) => (
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(l.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(l.id); } }}
                className={`w-full group rounded-lg transition-all text-left grid grid-cols-[48px_72px_1fr] items-start gap-1.5 p-2.5 cursor-pointer ${
                  l.isActive
                    ? "bg-surface border border-foreground/15 shadow-sm"
                    : "border border-transparent hover:bg-surface hover:border-border hover:shadow-xs"
                }`}
              >
                <span className="text-[12px] num text-foreground-subtle font-medium text-right pt-0.5">{l.lineNum}</span>
                <div className="flex flex-col items-start gap-1">
                  <span className="text-[10.5px] num text-foreground-subtle font-mono">{l.timeCode}</span>
                  {l.generatedAudio && onPlayLine && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onPlayLine(l.id); }}
                      className="size-6 rounded-full bg-canvas border border-border flex items-center justify-center hover:border-foreground-muted"
                    >
                      <Play className="size-3 fill-foreground text-foreground ml-0.5" />
                    </button>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className={`size-4 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold ${l.characterColor}`}>{l.characterName?.[0] || "?"}</div>
                    <span className="text-[11px] font-semibold truncate">{l.characterName || "Unknown"}</span>
                    <StateBadge state={l.state} />
                  </div>
                  <p className="text-[13px] text-foreground leading-relaxed line-clamp-2">{l.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
