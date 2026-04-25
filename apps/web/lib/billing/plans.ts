export type PlanId = "free" | "pro_monthly" | "pro_yearly";

export interface PlanLimits {
  projects: number;
  imports_per_period: number;
  transcription_minutes: number;
  line_gens: number;
  preview_gens: number;
  voice_uploads: number;
  storage_bytes: number;
}

export interface PlanDef {
  id: PlanId;
  name: string;
  tagline: string;
  price_cents: number;
  interval: "month" | "year";
  limits: PlanLimits;
  dodo_product_id: string | null;
  highlighted?: boolean;
}

const GB = 1024 * 1024 * 1024;
const UNLIMITED = 999_999;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Try CastWeave with generous limits",
    price_cents: 0,
    interval: "month",
    limits: {
      projects: 2,
      imports_per_period: 3,
      transcription_minutes: 30,
      line_gens: 50,
      preview_gens: 10,
      voice_uploads: 3,
      storage_bytes: 500 * 1024 * 1024, // 500 MB
    },
    dodo_product_id: null,
  },
  pro_monthly: {
    id: "pro_monthly",
    name: "Pro",
    tagline: "Full power for professional creators",
    price_cents: 1900,
    interval: "month",
    limits: {
      projects: 25,
      imports_per_period: UNLIMITED,
      transcription_minutes: 300,
      line_gens: 1000,
      preview_gens: 200,
      voice_uploads: 25,
      storage_bytes: 10 * GB,
    },
    dodo_product_id: process.env.NEXT_PUBLIC_DODO_PRO_MONTHLY_PRODUCT_ID ?? null,
    highlighted: true,
  },
  pro_yearly: {
    id: "pro_yearly",
    name: "Pro (Annual)",
    tagline: "Best value — save 17%",
    price_cents: 19000,
    interval: "year",
    limits: {
      projects: 25,
      imports_per_period: UNLIMITED,
      transcription_minutes: 300,
      line_gens: 1000,
      preview_gens: 200,
      voice_uploads: 25,
      storage_bytes: 10 * GB,
    },
    dodo_product_id: process.env.NEXT_PUBLIC_DODO_PRO_YEARLY_PRODUCT_ID ?? null,
  },
};

export const PLAN_LIST: PlanDef[] = [PLANS.free, PLANS.pro_monthly, PLANS.pro_yearly];

export function planLimits(planId: string): PlanLimits {
  const key = planId as PlanId;
  return PLANS[key]?.limits ?? PLANS.free.limits;
}

export function planName(planId: string): string {
  return (PLANS as Record<string, PlanDef>)[planId]?.name ?? "Free";
}

export function isPro(planId: string): boolean {
  return planId === "pro_monthly" || planId === "pro_yearly";
}

export function formatStorage(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export function formatPrice(cents: number, interval: "month" | "year"): string {
  const dollars = (cents / 100).toFixed(0);
  if (cents === 0) return "Free";
  return `$${dollars}/${interval === "year" ? "yr" : "mo"}`;
}
