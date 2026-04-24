"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { ProjectProvider } from "./ProjectProvider";
import { ToastProvider } from "./ToastProvider";
import { setApiAuthToken } from "@/lib/api/client";

const TOKEN_REFRESH_MS = 25 * 60 * 1000; // 25 min (tokens expire at 30 min)

function SyncApiUser({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status === "loading") return;

    if (status !== "authenticated" || !session?.user?.email) {
      setApiAuthToken(null);
      setReady(true);
      return;
    }

    let cancelled = false;

    async function fetchToken() {
      try {
        const res = await fetch("/api/auth/api-token");
        if (res.ok) {
          const { token } = await res.json();
          if (!cancelled) setApiAuthToken(token);
        } else {
          if (!cancelled) setApiAuthToken(null);
        }
      } catch {
        if (!cancelled) setApiAuthToken(null);
      }
      if (!cancelled) setReady(true);
    }

    fetchToken();
    const interval = setInterval(fetchToken, TOKEN_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session?.user?.email, status]);

  if (!ready) return null;
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SyncApiUser>
        <ToastProvider>
          <ProjectProvider>{children}</ProjectProvider>
        </ToastProvider>
      </SyncApiUser>
    </SessionProvider>
  );
}
