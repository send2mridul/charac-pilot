"use client";

import { CheckCircle2, AlertCircle, AlertTriangle, Plus, Play, UserPlus } from "lucide-react";
import Link from "next/link";

export type CastMember = {
  id: string;
  name: string;
  initials: string;
  segments: number;
  voice: string | null;
  active?: boolean;
  unidentified?: boolean;
  color: string;
  onCreateCharacter?: () => void;
  onPreview?: () => void;
};

type Group = "ready" | "needs-voice" | "needs-character";

function groupOf(c: CastMember): Group {
  if (c.unidentified) return "needs-character";
  if (!c.voice) return "needs-voice";
  return "ready";
}

const groupMeta: Record<Group, { label: string; helper: string; tone: string }> = {
  "needs-character": { label: "Needs character", helper: "Detected speakers without an identity", tone: "text-foreground-subtle" },
  "needs-voice": { label: "Needs voice", helper: "Characters that cannot generate yet", tone: "text-warning-foreground" },
  "ready": { label: "Ready to generate", helper: "Character and voice attached", tone: "text-success" },
};

function CastCard({ c }: { c: CastMember }) {
  const g = groupOf(c);
  return (
    <article className={`group relative rounded-lg border transition-all cursor-pointer ${
      c.active ? "bg-surface border-foreground/20 shadow-sm" : "bg-surface border-border hover:border-border-strong hover:shadow-xs"
    }`}>
      {c.active && <span className="absolute -left-px top-3 bottom-3 w-[3px] rounded-r bg-foreground" />}
      <div className="p-3 flex items-start gap-3">
        <div className={`size-10 rounded-full shrink-0 flex items-center justify-center text-[12.5px] font-bold ${c.color}`}>{c.initials}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold text-foreground truncate leading-tight tracking-tight">{c.name}</div>
          <div className="text-[11px] text-foreground-subtle num mt-0.5">{c.segments} lines</div>
          {g === "needs-character" ? (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-foreground-subtle"><AlertCircle className="size-3.5 shrink-0" /> No character yet</div>
          ) : g === "ready" ? (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-success"><CheckCircle2 className="size-3.5 shrink-0" /><span className="truncate">{c.voice}</span></div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-warning-foreground"><AlertTriangle className="size-3.5 shrink-0" /> No voice attached</div>
          )}
        </div>
      </div>
      {g === "needs-character" ? (
        <div className="px-3 pb-3">
          <button onClick={c.onCreateCharacter} className="w-full h-8 rounded-md text-[12px] font-bold bg-foreground text-surface hover:bg-foreground/90 transition-colors flex items-center justify-center gap-1.5">
            <UserPlus className="size-3.5" /> Create character
          </button>
        </div>
      ) : g === "ready" ? (
        <div className="px-3 pb-2.5 flex gap-1.5">
          <button onClick={c.onPreview} className="h-7 px-2 rounded-md text-[11px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas border border-border flex items-center gap-1.5 transition-colors">
            <Play className="size-3 fill-current" /> Preview
          </button>
          <Link href="/voice-studio" className="h-7 px-2 rounded-md text-[11px] font-semibold text-foreground-muted hover:text-foreground hover:bg-canvas border border-border transition-colors flex items-center">Change voice</Link>
        </div>
      ) : (
        <div className="px-3 pb-3">
          <Link href="/voice-studio" className="w-full h-8 rounded-md text-[12px] font-bold bg-warning text-white hover:bg-warning/90 transition-colors flex items-center justify-center gap-1.5">Attach voice</Link>
        </div>
      )}
    </article>
  );
}

export function CastPanel({ cast, onAddManually }: { cast: CastMember[]; onAddManually?: () => void }) {
  const grouped: Record<Group, CastMember[]> = {
    "needs-character": cast.filter(c => groupOf(c) === "needs-character"),
    "needs-voice": cast.filter(c => groupOf(c) === "needs-voice"),
    "ready": cast.filter(c => groupOf(c) === "ready"),
  };
  const order: Group[] = ["needs-character", "needs-voice", "ready"];
  const readyCount = grouped.ready.length;

  return (
    <aside className="w-[320px] shrink-0 bg-canvas border-r border-border flex flex-col min-h-0">
      <div className="h-12 shrink-0 px-5 flex items-center justify-between border-b border-border">
        <div className="flex items-baseline gap-2">
          <h2 className="label-section">Cast</h2>
          <span className="text-[11px] text-foreground-subtle num font-semibold">{readyCount}/{cast.length} ready</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
        {order.map(g => grouped[g].length > 0 && (
          <section key={g} className="flex flex-col gap-2">
            <div className="px-1 flex items-baseline justify-between">
              <span className={`text-[10.5px] font-bold tracking-[0.14em] uppercase ${groupMeta[g].tone}`}>{groupMeta[g].label}</span>
              <span className="text-[10.5px] num font-semibold text-foreground-subtle">{grouped[g].length}</span>
            </div>
            <p className="text-[11px] text-foreground-subtle px-1 -mt-1 leading-snug">{groupMeta[g].helper}</p>
            <div className="flex flex-col gap-2 mt-1">
              {grouped[g].map(c => <CastCard key={c.id} c={c} />)}
            </div>
          </section>
        ))}
      </div>
      <div className="p-3 border-t border-border">
        <button onClick={onAddManually} className="w-full h-9 rounded-md text-[12.5px] font-semibold text-foreground-muted hover:text-foreground hover:bg-surface border border-dashed border-border-strong flex items-center justify-center gap-1.5 transition-colors">
          <Plus className="size-3.5" /> Add character manually
        </button>
      </div>
    </aside>
  );
}
