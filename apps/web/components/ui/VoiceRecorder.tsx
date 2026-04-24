"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecordingState = "idle" | "recording" | "recorded" | "saving";

type Props = {
  onSave: (blob: Blob) => Promise<void>;
  maxDurationSec?: number;
};

export default function VoiceRecorder({ onSave, maxDurationSec = 30 }: Props) {
  const [state, setState] = useState<RecordingState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() => Array(24).fill(0));

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    timerRef.current = null;
    animRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setState("recorded");
        cleanup();
      };
      mediaRecRef.current = rec;
      rec.start(200);
      setState("recording");
      setElapsed(0);

      const t0 = Date.now();
      timerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - t0) / 1000);
        setElapsed(sec);
        if (sec >= maxDurationSec) {
          rec.stop();
        }
      }, 250);

      const drawLevels = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const bars = 24;
        const step = Math.max(1, Math.floor(data.length / bars));
        const l: number[] = [];
        for (let i = 0; i < bars; i++) {
          l.push((data[i * step] ?? 0) / 255);
        }
        setLevels(l);
        animRef.current = requestAnimationFrame(drawLevels);
      };
      drawLevels();
    } catch (e) {
      setError("Microphone access denied. Please allow microphone access.");
      setState("idle");
    }
  };

  const stopRecording = () => {
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      mediaRecRef.current.stop();
    }
  };

  const reRecord = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    blobRef.current = null;
    setState("idle");
    setElapsed(0);
    setLevels(Array(24).fill(0));
  };

  const handleSave = async () => {
    if (!blobRef.current) return;
    setState("saving");
    try {
      await onSave(blobRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setState("recorded");
    }
  };

  const fmtTime = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      {/* Waveform bars */}
      <div className="flex h-16 items-end justify-center gap-px rounded-lg bg-surface-sunken/50 px-2">
        {levels.map((v, i) => (
          <div
            key={i}
            className="w-1.5 rounded-t bg-primary transition-all duration-75"
            style={{ height: `${Math.max(4, v * 100)}%`, opacity: state === "recording" ? 1 : 0.3 }}
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="font-mono text-muted-foreground">
          {fmtTime(elapsed)} / {fmtTime(maxDurationSec)}
        </span>
        {state === "recording" && (
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
            Recording
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {state === "idle" && (
          <button
            type="button"
            onClick={startRecording}
            className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90"
          >
            Start Recording
          </button>
        )}
        {state === "recording" && (
          <button
            type="button"
            onClick={stopRecording}
            className="flex-1 rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Stop
          </button>
        )}
        {state === "recorded" && (
          <>
            <button
              type="button"
              onClick={reRecord}
              className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-primary/5"
            >
              Re-record
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90"
            >
              Use this recording
            </button>
          </>
        )}
        {state === "saving" && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Saving...
          </div>
        )}
      </div>

      {audioUrl && state === "recorded" && (
        <audio controls src={audioUrl} className="w-full rounded-lg" />
      )}
    </div>
  );
}
