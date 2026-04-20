import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-canvas text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="relative min-h-0 flex-1 overflow-y-auto bg-canvas">
          <div className="relative mx-auto max-w-[1280px] px-8 py-10 lg:px-12">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
