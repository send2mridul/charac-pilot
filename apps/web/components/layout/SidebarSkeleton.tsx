export function SidebarSkeleton() {
  return (
    <aside className="relative flex h-full w-64 shrink-0 flex-col border-r border-white/[0.08] bg-panel/90 backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4">
        <div className="h-9 w-9 shrink-0 rounded-xl bg-white/[0.06]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-24 rounded-md bg-white/[0.06]" />
          <div className="h-2.5 w-16 rounded-md bg-white/[0.05]" />
        </div>
      </div>
      <div className="flex-1 space-y-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-xl bg-white/[0.04]"
            style={{ opacity: 1 - i * 0.06 }}
          />
        ))}
      </div>
      <div className="border-t border-white/[0.06] p-4">
        <div className="h-16 rounded-xl bg-white/[0.04]" />
      </div>
    </aside>
  );
}
