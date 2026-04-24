"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ProjectProvider } from "./ProjectProvider";
import { ToastProvider } from "./ToastProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <ProjectProvider>{children}</ProjectProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
