export function TopBarSkeleton() {
  return (
    <header className="sticky top-0 z-10 flex min-h-[72px] items-center justify-between gap-4 border-b border-white/[0.06] bg-canvas/80 px-6 py-4 backdrop-blur-md">
      <div className="space-y-2">
        <div className="h-2.5 w-20 rounded bg-white/[0.06]" />
        <div className="h-4 w-40 rounded bg-white/[0.08]" />
        <div className="h-2.5 w-48 rounded bg-white/[0.05]" />
      </div>
      <div className="flex flex-1 items-center justify-end gap-3">
        <div className="hidden h-10 max-w-md flex-1 rounded-xl bg-white/[0.05] md:block" />
        <div className="h-10 w-10 shrink-0 rounded-xl bg-white/[0.05]" />
        <div className="h-10 w-28 shrink-0 rounded-xl bg-white/[0.05]" />
      </div>
    </header>
  );
}
