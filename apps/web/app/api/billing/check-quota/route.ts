import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { findUserByEmail } from "@/lib/db/users";
import { checkQuota } from "@/lib/db/usage";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ allowed: true });
  }

  try {
    const { field, amount } = await request.json();
    if (!field) {
      return NextResponse.json({ allowed: true });
    }

    const user = await findUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ allowed: true });
    }

    const result = await checkQuota(user.id, user.plan, field, amount ?? 1);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Quota check error:", err);
    return NextResponse.json({ allowed: true });
  }
}
