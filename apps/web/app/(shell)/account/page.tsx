"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Crown,
  ExternalLink,
  LogOut,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import {
  PLANS,
  formatStorage,
  formatPrice,
  isPro,
  type PlanLimits,
} from "@/lib/billing/plans";

interface UsageData {
  plan: string;
  plan_name: string;
  is_pro: boolean;
  usage: {
    projects_count: number;
    imports: number;
    media_seconds: number;
    storage_bytes: number;
    line_gens: number;
    preview_gens: number;
    voice_uploads: number;
    period_start: string;
    period_end: string;
  } | null;
  limits: PlanLimits;
}

export default function AccountPage() {
  const { data: session } = useSession();
  const params = useSearchParams();
  const checkoutSuccess = params.get("checkout") === "success";
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  function refreshUsage() {
    setLoading(true);
    fetch("/api/billing/usage")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refreshUsage();
    if (checkoutSuccess) {
      const timer = setTimeout(refreshUsage, 3000);
      return () => clearTimeout(timer);
    }
  }, [checkoutSuccess]);

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const d = await res.json();
      if (d.url) window.location.href = d.url;
      else alert(d.error || "Could not open billing portal");
    } catch {
      alert("Billing service unavailable");
    } finally {
      setPortalLoading(false);
    }
  }

  const plan = data?.plan ?? "free";
  const limits = data?.limits ?? PLANS.free.limits;
  const usage = data?.usage;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Account</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Manage your plan, usage, and billing.
          </p>
        </div>

        {checkoutSuccess && (
          <div className="flex items-center gap-3 bg-success-soft border border-success-border rounded-lg px-4 py-3">
            <CheckCircle2 className="size-5 text-success shrink-0" />
            <p className="text-sm font-medium text-success">
              Payment successful! Your plan has been upgraded.
            </p>
          </div>
        )}

        {/* Profile card */}
        <section className="bg-surface border border-border rounded-xl p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground-muted mb-4">
            Profile
          </h2>
          <div className="flex items-center gap-4">
            {session?.user?.image && (
              <img
                src={session.user.image}
                alt=""
                className="size-12 rounded-full"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-lg truncate">
                {session?.user?.name || "User"}
              </div>
              <div className="text-sm text-foreground-muted truncate">
                {session?.user?.email}
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/sign-in" })}
              className="h-9 px-4 rounded-lg border border-border text-sm font-semibold text-foreground-muted hover:text-danger hover:border-danger/40 flex items-center gap-2 transition-colors"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </section>

        {/* Plan card */}
        <section className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground-muted">
              Current plan
            </h2>
            {isPro(plan) && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-accent bg-accent-soft px-2.5 py-1 rounded-full">
                <Crown className="size-3.5" /> PRO
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold tracking-tight">
              {data?.plan_name || "Free"}
            </span>
            {isPro(plan) && (
              <span className="text-sm text-foreground-muted">
                {formatPrice(
                  PLANS[plan as keyof typeof PLANS]?.price_cents ?? 0,
                  PLANS[plan as keyof typeof PLANS]?.interval ?? "month",
                )}
              </span>
            )}
          </div>
          {usage?.period_end && (
            <p className="text-xs text-foreground-muted mt-1">
              Current period ends{" "}
              {new Date(usage.period_end).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            {!isPro(plan) && (
              <Link
                href="/pricing"
                className="h-9 px-5 rounded-lg bg-accent text-white text-sm font-bold flex items-center gap-2 hover:bg-accent-hover transition-colors"
              >
                <Sparkles className="size-4" /> Upgrade to Pro
              </Link>
            )}
            {isPro(plan) && (
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="h-9 px-4 rounded-lg border border-border text-sm font-semibold flex items-center gap-2 hover:bg-canvas transition-colors disabled:opacity-50"
              >
                <ExternalLink className="size-4" />{" "}
                {portalLoading ? "Opening..." : "Manage subscription"}
              </button>
            )}
          </div>
        </section>

        {/* Usage card */}
        <section className="bg-surface border border-border rounded-xl p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground-muted mb-5">
            Usage this period
          </h2>
          {loading ? (
            <p className="text-sm text-foreground-muted">Loading usage...</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
              <UsageMeter
                label="Projects"
                used={usage?.projects_count ?? 0}
                limit={limits.projects}
              />
              <UsageMeter
                label="Imports"
                used={usage?.imports ?? 0}
                limit={limits.imports_per_period}
              />
              <UsageMeter
                label="Transcription"
                used={Math.round((usage?.media_seconds ?? 0) / 60)}
                limit={limits.transcription_minutes}
                unit="min"
              />
              <UsageMeter
                label="Line generations"
                used={usage?.line_gens ?? 0}
                limit={limits.line_gens}
              />
              <UsageMeter
                label="Voice previews"
                used={usage?.preview_gens ?? 0}
                limit={limits.preview_gens}
              />
              <UsageMeter
                label="Voice uploads"
                used={usage?.voice_uploads ?? 0}
                limit={limits.voice_uploads}
              />
              <UsageMeter
                label="Storage"
                used={usage?.storage_bytes ?? 0}
                limit={limits.storage_bytes}
                formatter={formatStorage}
              />
            </div>
          )}
          {!isPro(plan) && !loading && (
            <div className="mt-6 pt-4 border-t border-border flex items-center gap-3">
              <AlertCircle className="size-4 text-foreground-muted shrink-0" />
              <p className="text-xs text-foreground-muted flex-1">
                Need more? Upgrade to Pro for higher limits.
              </p>
              <Link
                href="/pricing"
                className="text-xs font-bold text-accent hover:underline"
              >
                View plans
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function UsageMeter({
  label,
  used,
  limit,
  unit,
  formatter,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
  formatter?: (n: number) => string;
}) {
  const isUnlimited = limit >= 999_999;
  const ratio = isUnlimited ? 0 : Math.min(1, used / Math.max(limit, 1));
  const pct = Math.round(ratio * 100);
  const warn = ratio >= 0.8;
  const over = ratio >= 1;

  const fmt = formatter ?? ((n: number) => `${n}${unit ? ` ${unit}` : ""}`);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className={`text-xs font-mono tabular-nums ${over ? "text-danger font-bold" : warn ? "text-warning-foreground" : "text-foreground-muted"}`}
        >
          {fmt(used)}
          {isUnlimited ? "" : ` / ${fmt(limit)}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${over ? "bg-danger" : warn ? "bg-warning" : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
