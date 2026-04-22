/** Single shared preview player so overlapping clips never stack. */

let activeAudio: HTMLAudioElement | null = null;

export function stopVoicePreview(): void {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.currentTime = 0;
  activeAudio = null;
}

export function playVoicePreview(
  url: string,
  hooks?: { onPlay?: () => void; onEnd?: () => void },
): Promise<void> {
  stopVoicePreview();
  const audio = new Audio(url);
  activeAudio = audio;
  const cleanup = () => {
    if (activeAudio === audio) {
      activeAudio = null;
      hooks?.onEnd?.();
    }
  };
  audio.addEventListener(
    "play",
    () => {
      hooks?.onPlay?.();
    },
    { once: true },
  );
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  return audio.play().then(() => undefined);
}
