"use client";

import { useState } from "react";
import { Play, Download, Film, AudioWaveform, FileAudio, Clock } from "lucide-react";

export interface AssetClip {
  id: string;
  name: string;
  duration?: string;
  character?: string;
  audioUrl?: string;
  onPlay?: () => void;
}

interface Props {
  clips: AssetClip[];
  frames: string[];
  onPlayFrame?: (idx: number) => void;
}

export function AssetsStrip({ clips, frames, onPlayFrame }: Props) {
  const [tab, setTab] = useState<"frames" | "clips">(frames.length > 0 ? "frames" : "clips");

  return (
    <section className="shrink-0 bg-surface border-t border-border">
      {/* Tab header */}
      <div className="h-10 flex items-center px-5 gap-4 border-b border-border-subtle">
        <button
          onClick={() => setTab("frames")}
          className={`text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${
            tab === "frames" ? "text-foreground" : "text-foreground-subtle hover:text-foreground"
          }`}
        >
          <Film className="size-3.5" /> Frames
          {frames.length > 0 && <span className="text-[10px] num text-foreground-subtle">({frames.length})</span>}
        </button>
        <button
          onClick={() => setTab("clips")}
          className={`text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${
            tab === "clips" ? "text-foreground" : "text-foreground-subtle hover:text-foreground"
          }`}
        >
          <FileAudio className="size-3.5" /> Saved clips
          {clips.length > 0 && <span className="text-[10px] num text-foreground-subtle">({clips.length})</span>}
        </button>
      </div>

      {/* Content */}
      <div className="h-[120px] overflow-x-auto overflow-y-hidden px-5 py-3 flex gap-3">
        {tab === "frames" ? (
          frames.length > 0 ? (
            frames.map((src, i) => (
              <button
                key={i}
                onClick={() => onPlayFrame?.(i)}
                className="shrink-0 h-full aspect-video rounded-lg overflow-hidden border border-border hover:border-border-strong bg-canvas group relative"
              >
                <img src={src} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-foreground/0 group-hover:bg-foreground/10 transition-colors">
                  <Play className="size-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md fill-white" />
                </div>
              </button>
            ))
          ) : (
            <div className="flex items-center text-[12px] text-foreground-subtle">No frames extracted yet.</div>
          )
        ) : (
          clips.length > 0 ? (
            clips.map(c => (
              <div key={c.id} className="shrink-0 h-full w-[200px] rounded-lg bg-canvas border border-border p-3 flex flex-col justify-between hover:border-border-strong transition-colors">
                <div>
                  <div className="text-[12px] font-semibold truncate">{c.name}</div>
                  <div className="text-[10.5px] text-foreground-subtle num flex items-center gap-1 mt-0.5">{c.character && <><span>{c.character}</span><span>&middot;</span></>}<Clock className="size-2.5" />{c.duration || "--"}</div>
                </div>
                {c.onPlay && (
                  <button onClick={c.onPlay} className="self-start size-7 rounded-full bg-surface border border-border flex items-center justify-center hover:border-foreground-muted mt-1">
                    <Play className="size-3 fill-foreground text-foreground ml-0.5" />
                  </button>
                )}
              </div>
            ))
          ) : (
            <div className="flex items-center text-[12px] text-foreground-subtle">No saved clips yet. Generate audio to see them here.</div>
          )
        )}
      </div>
    </section>
  );
}
