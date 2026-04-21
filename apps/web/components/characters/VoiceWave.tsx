interface VoiceWaveProps {
  bars?: number;
  className?: string;
  active?: boolean;
}

export function VoiceWave({ bars = 18, className, active = true }: VoiceWaveProps) {
  return (
    <div className={["flex h-6 items-center gap-[2px]", className].filter(Boolean).join(" ")}>
      {Array.from({ length: bars }).map((_, i) => {
        const height = 30 + ((i * 37) % 70);
        return (
          <span
            key={i}
            className={[
              "block w-[2px] rounded-full bg-[var(--primary)]",
              active ? "wave-bar" : "",
            ].join(" ")}
            style={{
              height: `${height}%`,
              animationDelay: `${(i * 80) % 600}ms`,
              opacity: active ? 0.85 : 0.4,
            }}
          />
        );
      })}
    </div>
  );
}
