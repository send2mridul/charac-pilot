import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="relative min-h-0 flex-1 overflow-y-auto bg-background">
          <div className="relative mx-auto w-full max-w-[min(100vw,1920px)] px-4 py-6 sm:px-6 lg:px-8 xl:px-10 float-in">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
