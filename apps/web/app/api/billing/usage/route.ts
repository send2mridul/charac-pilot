import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findUserByEmail } from "@/lib/db/users";
import { getOrCreateUsage } from "@/lib/db/usage";
import { planLimits, planName, isPro } from "@/lib/billing/plans";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await findUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({
        plan: "free",
        plan_name: "Free",
        is_pro: false,
        usage: null,
        limits: planLimits("free"),
      });
    }

    const usage = await getOrCreateUsage(user.id);
    const limits = planLimits(user.plan);

    return NextResponse.json({
      plan: user.plan,
      plan_name: planName(user.plan),
      is_pro: isPro(user.plan),
      usage,
      limits,
    });
  } catch (err) {
    console.error("Usage fetch error:", err);
    return NextResponse.json(
      { plan: "free", plan_name: "Free", is_pro: false, usage: null, limits: planLimits("free") },
    );
  }
}
