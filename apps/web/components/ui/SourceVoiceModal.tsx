"use client";

import { useState, type FormEvent } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

const RIGHTS_OPTIONS = [
  { value: "own_voice", label: "My own voice" },
  { value: "hired_actor", label: "Hired voice actor or licensed voice" },
  { value: "ai_generated", label: "AI-generated voice I own" },
  { value: "other_authorized", label: "Other authorized use" },
] as const;

export type SourceVoiceModalProps = {
  characterName: string;
  onConfirm: (rightsType: string, proofNote: string) => void;
  onCancel: () => void;
  busy?: boolean;
};

export function SourceVoiceModal({
  characterName,
  onConfirm,
  onCancel,
  busy = false,
}: SourceVoiceModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [rightsType, setRightsType] = useState<string>("own_voice");
  const [proofNote, setProofNote] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed) return;
    onConfirm(rightsType, proofNote.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-card p-6 shadow-2xl"
      >
        <h3 className="text-base font-semibold text-text">
          Use source-matched voice
        </h3>
        <p className="mt-2 text-sm text-muted">
          This will create a voice modeled after{" "}
          <span className="font-medium text-text">{characterName}</span> from
          the uploaded video. A rights confirmation is required.
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 transition hover:bg-white/[0.06]">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/10 accent-accent"
          />
          <span className="text-sm leading-snug text-text">
            I own this voice or have explicit permission to clone and use it for
            audio generation.
          </span>
        </label>

        <div className="mt-4">
          <label className="text-xs font-medium text-muted">
            Source type (optional)
          </label>
          <select
            className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
            value={rightsType}
            onChange={(e) => setRightsType(e.target.value)}
          >
            {RIGHTS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium text-muted">
            Notes or proof (optional)
          </label>
          <textarea
            className="mt-1 w-full resize-none rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
            rows={2}
            placeholder="License reference, actor name, etc."
            value={proofNote}
            onChange={(e) => setProofNote(e.target.value)}
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <button
            type="submit"
            disabled={!confirmed || busy}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Spinner className="h-4 w-4 border-t-primary-foreground" />
                Setting up voice…
              </>
            ) : (
              "Confirm and create voice"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
