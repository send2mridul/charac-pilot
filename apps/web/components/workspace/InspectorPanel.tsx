"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  Mic2,
  Play,
  Save,
  Sparkles,
  Video,
} from "lucide-react";

export interface InspectorData {
  lineId: string;
  lineNum: number;
  timeCode: string;
  characterName: string;
  characterId?: string;
  voiceName?: string | null;
  voiceId?: string | null;
  text: string;
  isGenerated: boolean;
  isBlocked: boolean;
  blockReason?: string;
  generatedAudioUrl?: string | null;
  deliveryPreset?: string;
  takes?: { id: string; takeNum: number; isActive: boolean }[];
  sourceKind: "video" | "audio";
  characterColor: string;
}

interface Props {
  data: InspectorData | null;
  onTextChange: (text: string) => void;
  onSaveText: () => void;
  onGenerate: () => void;
  onPlayGenerated: () => void;
  onPlaySource: () => void;
  onPresetChange: (preset: string) => void;
  presets: string[];
  generating: boolean;
  savingText?: boolean;
}

export function InspectorPanel({
  data,
  onTextChange,
  onSaveText,
  onGenerate,
  onPlayGenerated,
  onPlaySource,
  onPresetChange,
  presets,
  generating,
  savingText,
}: Props) {
  if (!data) {
    return (
      <aside className="w-[400px] shrink-0 bg-canvas border-l border-border flex flex-col items-center justify-center text-center p-8 text-foreground-muted gap-3">
        <div className="size-14 rounded-full bg-surface border border-border flex items-center justify-center">
          <Sparkles className="size-6 text-foreground-subtle" />
        </div>
        <div className="text-[14px] font-semibold">Select a line</div>
        <div className="text-[12px] text-foreground-subtle max-w-[240px]">Click a transcript line on the left to inspect and generate audio for it.</div>
      </aside>
    );
  }

  return (
    <aside className="w-[400px] shrink-0 bg-canvas border-l border-border flex flex-col min-h-0">
      {/* Header */}
      <div className="h-12 shrink-0 px-5 flex items-center justify-between border-b border-border">
        <h2 className="label-section">Inspector</h2>
        <span className="text-[10.5px] num text-foreground-subtle font-semibold">Line {data.lineNum} &middot; {data.timeCode}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
        {/* Source */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <span className="label-eyebrow">Source</span>
            <button onClick={onPlaySource} className="size-7 rounded-full bg-surface border border-border flex items-center justify-center hover:border-foreground-muted">
              <Play className="size-3 fill-foreground text-foreground ml-0.5" />
            </button>
          </div>
          <div className="h-14 bg-surface border border-border rounded-lg flex items-center px-4 gap-3">
            {data.sourceKind === "audio" ? <Mic2 className="size-5 text-foreground-subtle" /> : <Video className="size-5 text-foreground-subtle" />}
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-foreground truncate">{data.sourceKind === "audio" ? "Audio source" : "Video source"}</div>
              <div className="text-[10.5px] text-foreground-subtle num">{data.timeCode}</div>
            </div>
          </div>
        </section>

        {/* Character & voice */}
        <section>
          <span className="label-eyebrow mb-2 block">Character & voice</span>
          <div className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg">
            <div className={`size-10 rounded-full shrink-0 flex items-center justify-center text-[13px] font-bold ${data.characterColor}`}>
              {data.characterName?.[0] || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold truncate">{data.characterName}</div>
              {data.voiceName ? (
                <div className="flex items-center gap-1 text-[11px] text-success font-semibold"><CheckCircle2 className="size-3" />{data.voiceName}</div>
              ) : (
                <div className="flex items-center gap-1 text-[11px] text-warning-foreground font-semibold"><AlertCircle className="size-3" />No voice</div>
              )}
            </div>
          </div>
        </section>

        {/* Editable text */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <span className="label-eyebrow">Line text</span>
            <button
              onClick={onSaveText}
              disabled={savingText}
              className="h-7 px-2 rounded-md text-[11px] font-semibold text-foreground-muted hover:text-foreground hover:bg-surface border border-border transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <Save className="size-3" /> Save
            </button>
          </div>
          <textarea
            value={data.text}
            onChange={(e) => onTextChange(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-[13px] leading-relaxed bg-surface border border-border rounded-lg focus:outline-none focus:border-border-strong resize-none"
          />
        </section>

        {/* Delivery preset */}
        <section>
          <span className="label-eyebrow mb-2 block">Delivery</span>
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => onPresetChange(p)}
                className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${
                  data.deliveryPreset === p
                    ? "bg-foreground text-surface shadow-xs"
                    : "bg-surface border border-border text-foreground-muted hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </section>

        {/* Generated audio */}
        {data.generatedAudioUrl && (
          <section>
            <span className="label-eyebrow mb-2 block">Generated audio</span>
            <div className="h-14 bg-surface border border-border rounded-lg flex items-center px-4 gap-3">
              <button onClick={onPlayGenerated} className="size-8 rounded-full bg-foreground text-surface flex items-center justify-center hover:bg-foreground/90 shadow-xs">
                <Play className="size-3.5 fill-current ml-0.5" />
              </button>
              <div className="flex-1 h-2 rounded-full bg-canvas overflow-hidden">
                <div className="h-full w-1/3 bg-accent rounded-full" />
              </div>
              <span className="label-section text-success">Active</span>
            </div>
          </section>
        )}

        {/* Blocked guidance */}
        {data.isBlocked && data.blockReason && (
          <div className="rounded-lg bg-warning-soft border border-warning-border p-4 text-[12.5px]">
            <div className="flex items-center gap-2 text-warning-foreground font-semibold">
              <AlertCircle className="size-4 shrink-0" /> Cannot generate
            </div>
            <p className="text-[11.5px] text-warning-foreground/80 mt-1.5 ml-6">{data.blockReason}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-5 border-t border-border bg-surface">
        <button
          onClick={onGenerate}
          disabled={data.isBlocked || generating || !data.voiceId}
          className="w-full h-10 rounded-lg text-[13.5px] font-bold bg-accent text-white hover:bg-accent-hover transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {generating ? "Generating..." : data.isGenerated ? "Regenerate audio" : "Generate audio"}
        </button>
        {data.isBlocked && (
          <p className="text-[11px] text-foreground-subtle text-center mt-2">
            {data.blockReason || "This line is blocked from generation."}
          </p>
        )}
      </div>
    </aside>
  );
}
