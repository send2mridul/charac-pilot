"use client";

import Link from "next/link";
import { Crown } from "lucide-react";

interface Props {
  message: string;
  className?: string;
}

export function UpgradePrompt({ message, className = "" }: Props) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-accent/30 bg-accent-soft/20 px-4 py-3 ${className}`}
    >
      <Crown className="size-5 text-accent shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{message}</p>
        <Link
          href="/pricing"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-accent hover:underline"
        >
          View upgrade options
        </Link>
      </div>
    </div>
  );
}
