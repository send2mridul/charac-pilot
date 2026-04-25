"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Check, ArrowRight, Sparkles } from "lucide-react";
import { PLAN_LIST, formatPrice, formatStorage, isPro } from "@/lib/billing/plans";

export default function PricingPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleCheckout(planId: string) {
    if (!session?.user) {
      window.location.href = `/sign-in?callbackUrl=/pricing`;
      return;
    }
    setLoading(planId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to start checkout");
      }
    } catch {
      alert("Billing service unavailable");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--canvas,#fafaf9)]">
      <header className="border-b border-[var(--border,#e5e5e5)] bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Sparkles className="size-5 text-[var(--accent,#6366f1)]" />
            <span className="text-lg font-bold tracking-tight">CastWeave</span>
          </Link>
          {session?.user ? (
            <Link href="/projects" className="text-sm font-medium text-[var(--foreground-muted,#737373)] hover:text-[var(--foreground,#171717)]">
              Dashboard <ArrowRight className="inline size-3.5 ml-0.5" />
            </Link>
          ) : (
            <Link href="/sign-in" className="h-9 px-4 rounded-lg bg-[var(--foreground,#171717)] text-white text-sm font-semibold flex items-center">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-14">
          <h1 className="text-4xl font-extrabold tracking-tight">Simple, transparent pricing</h1>
          <p className="mt-3 text-lg text-[var(--foreground-muted,#737373)]">Start free. Upgrade when you need more.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {PLAN_LIST.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl border p-7 flex flex-col ${
                plan.highlighted
                  ? "border-[var(--accent,#6366f1)] shadow-lg shadow-[var(--accent,#6366f1)]/10 ring-1 ring-[var(--accent,#6366f1)]/20 relative"
                  : "border-[var(--border,#e5e5e5)] bg-white"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[var(--accent,#6366f1)] text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  Most popular
                </div>
              )}
              <div>
                <h2 className="text-xl font-bold">{plan.name}</h2>
                <p className="text-sm text-[var(--foreground-muted,#737373)] mt-1">{plan.tagline}</p>
              </div>
              <div className="mt-5 mb-6">
                <span className="text-4xl font-extrabold tracking-tight">
                  {plan.price_cents === 0 ? "$0" : `$${(plan.price_cents / 100).toFixed(0)}`}
                </span>
                {plan.price_cents > 0 && (
                  <span className="text-sm text-[var(--foreground-muted,#737373)] ml-1">
                    /{plan.interval === "year" ? "year" : "month"}
                  </span>
                )}
                {plan.id === "pro_yearly" && (
                  <div className="text-xs text-[var(--accent,#6366f1)] font-semibold mt-1">
                    ~$15.83/month, save 17%
                  </div>
                )}
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                <Feature>{plan.limits.projects} projects</Feature>
                <Feature>{plan.limits.imports_per_period >= 999_999 ? "Unlimited" : plan.limits.imports_per_period} imports/mo</Feature>
                <Feature>{plan.limits.transcription_minutes} min transcription/mo</Feature>
                <Feature>{plan.limits.line_gens >= 999_999 ? "Unlimited" : `${plan.limits.line_gens}`} line generations/mo</Feature>
                <Feature>{plan.limits.preview_gens} voice previews/mo</Feature>
                <Feature>{plan.limits.voice_uploads} voice uploads/mo</Feature>
                <Feature>{formatStorage(plan.limits.storage_bytes)} storage</Feature>
              </ul>
              {plan.id === "free" ? (
                <Link
                  href={session ? "/projects" : "/sign-in"}
                  className="h-11 rounded-lg border border-[var(--border,#e5e5e5)] text-sm font-bold flex items-center justify-center hover:bg-[var(--canvas,#fafaf9)] transition-colors"
                >
                  {session ? "Go to dashboard" : "Get started free"}
                </Link>
              ) : (
                <button
                  onClick={() => handleCheckout(plan.id)}
                  disabled={loading !== null}
                  className={`h-11 rounded-lg text-sm font-bold flex items-center justify-center transition-colors disabled:opacity-50 ${
                    plan.highlighted
                      ? "bg-[var(--accent,#6366f1)] text-white hover:bg-[var(--accent-hover,#4f46e5)]"
                      : "bg-[var(--foreground,#171717)] text-white hover:bg-[var(--foreground,#171717)]/90"
                  }`}
                >
                  {loading === plan.id ? "Redirecting..." : `Upgrade to ${plan.name}`}
                </button>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Check className="size-4 text-[var(--accent,#6366f1)] shrink-0 mt-0.5" strokeWidth={2.5} />
      <span>{children}</span>
    </li>
  );
}
