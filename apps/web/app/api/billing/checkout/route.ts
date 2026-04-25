import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const DODO_BASE =
  process.env.DODO_ENVIRONMENT === "live"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Billing is not configured yet." },
      { status: 503 },
    );
  }

  const { plan_id } = await request.json();
  if (!plan_id || (plan_id !== "pro_monthly" && plan_id !== "pro_yearly")) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const productId =
    plan_id === "pro_monthly"
      ? process.env.NEXT_PUBLIC_DODO_PRO_MONTHLY_PRODUCT_ID
      : process.env.NEXT_PUBLIC_DODO_PRO_YEARLY_PRODUCT_ID;

  if (!productId) {
    return NextResponse.json(
      { error: "Product not configured for this plan." },
      { status: 503 },
    );
  }

  const returnBase =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://charac-pilot-web.vercel.app";

  try {
    const res = await fetch(`${DODO_BASE}/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        billing: { country: "US" },
        customer: { email: session.user.email, name: session.user.name || "" },
        payment_link: true,
        product_id: productId,
        quantity: 1,
        return_url: `${returnBase}/account?checkout=success`,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Dodo checkout error:", res.status, errBody);
      return NextResponse.json(
        { error: `Checkout failed: ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const url = data.payment_link;
    if (!url) {
      console.error("Dodo checkout: no payment_link in response", data);
      return NextResponse.json(
        { error: "No payment link returned" },
        { status: 502 },
      );
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error("Dodo checkout exception:", err);
    return NextResponse.json(
      { error: "Billing service unavailable" },
      { status: 502 },
    );
  }
}
