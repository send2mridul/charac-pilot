"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanLimits } from "./plans";

export interface BillingState {
  plan: string;
  planName: string;
  isPro: boolean;
  usage: {
    projects_count: number;
    imports: number;
    media_seconds: number;
    storage_bytes: number;
    line_gens: number;
    preview_gens: number;
    voice_uploads: number;
  } | null;
  limits: PlanLimits;
  loading: boolean;
  refresh: () => void;
}

const DEFAULT_LIMITS: PlanLimits = {
  projects: 2,
  imports_per_period: 3,
  transcription_minutes: 30,
  line_gens: 50,
  preview_gens: 10,
  voice_uploads: 3,
  storage_bytes: 500 * 1024 * 1024,
};

export function useBilling(): BillingState {
  const [plan, setPlan] = useState("free");
  const [planName, setPlanName] = useState("Free");
  const [pro, setPro] = useState(false);
  const [usage, setUsage] = useState<BillingState["usage"]>(null);
  const [limits, setLimits] = useState<PlanLimits>(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);

  const doFetch = useCallback(() => {
    setLoading(true);
    fetch("/api/billing/usage")
      .then((r) => r.json())
      .then((d) => {
        setPlan(d.plan ?? "free");
        setPlanName(d.plan_name ?? "Free");
        setPro(d.is_pro ?? false);
        setUsage(d.usage ?? null);
        setLimits(d.limits ?? DEFAULT_LIMITS);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { plan, planName, isPro: pro, usage, limits, loading, refresh: doFetch };
}
