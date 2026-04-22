"use client";

import type { ReactNode } from "react";
import { ProjectProvider } from "./ProjectProvider";
import { ToastProvider } from "./ToastProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ProjectProvider>{children}</ProjectProvider>
    </ToastProvider>
  );
}
