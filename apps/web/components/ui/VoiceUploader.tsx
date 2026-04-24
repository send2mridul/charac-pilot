"use client";

import { useRef, useState } from "react";

type Props = {
  onSave: (file: File) => Promise<void>;
};

const ACCEPTED = ".mp3,.wav,.m4a,.flac,.ogg,.aac,.wma,.webm";

export default function VoiceUploader({ onSave }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setFile(f);
    if (f) setAudioUrl(URL.createObjectURL(f));
    else setAudioUrl(null);
  };

  const handleSave = async () => {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      <label
        htmlFor="voice-upload-file"
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface-sunken/40 p-6 text-center transition-all hover:border-primary/40 hover:bg-primary/5"
      >
        <span className="text-sm font-semibold text-foreground">
          {file ? file.name : "Choose audio file"}
        </span>
        <span className="text-xs text-muted-foreground">
          MP3, WAV, M4A, FLAC, OGG, AAC, or WebM
        </span>
        <input
          id="voice-upload-file"
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ACCEPTED}
          onChange={handlePick}
        />
      </label>

      {audioUrl && file && (
        <audio controls src={audioUrl} className="w-full rounded-lg" />
      )}

      <div className="flex gap-2">
        {file && (
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (audioUrl) URL.revokeObjectURL(audioUrl);
              setAudioUrl(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-primary/5"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          disabled={!file || saving}
          onClick={handleSave}
          className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Uploading..." : "Use this file"}
        </button>
      </div>
    </div>
  );
}
