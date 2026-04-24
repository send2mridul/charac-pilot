export function SidebarSkeleton() {
  return (
    <aside className="w-[64px] shrink-0 bg-canvas border-r border-border flex flex-col items-center py-4 gap-3">
      <div className="size-9 rounded-lg bg-border animate-pulse" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="size-10 rounded-lg bg-border/50 animate-pulse" />
      ))}
    </aside>
  );
}
