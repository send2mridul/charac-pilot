"use client";

import type { ReactNode } from "react";
import { ProjectProvider } from "./ProjectProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return <ProjectProvider>{children}</ProjectProvider>;
}
