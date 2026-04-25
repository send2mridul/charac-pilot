import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { findUserByEmail } from "@/lib/db/users";
import { incrementUsage } from "@/lib/db/usage";

const VALID_FIELDS = [
  "projects_count",
  "imports",
  "media_seconds",
  "storage_bytes",
  "line_gens",
  "preview_gens",
  "voice_uploads",
] as const;

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { field, amount } = await request.json();
    if (!field || !VALID_FIELDS.includes(field)) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    const user = await findUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await withRetry(() => incrementUsage(user.id, field, amount ?? 1));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Usage track error:", err);
    return NextResponse.json({ error: "Failed to track" }, { status: 500 });
  }
}
