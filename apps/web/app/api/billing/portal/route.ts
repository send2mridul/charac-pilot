import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findUserByEmail } from "@/lib/db/users";

const DODO_BASE =
  process.env.DODO_ENVIRONMENT === "live"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Billing is not configured." },
      { status: 503 },
    );
  }

  const user = await findUserByEmail(session.user.email);
  if (!user?.dodo_customer_id) {
    return NextResponse.json(
      { error: "No billing account found. You may be on the free plan." },
      { status: 404 },
    );
  }

  try {
    const res = await fetch(
      `${DODO_BASE}/customers/${user.dodo_customer_id}/customer-portal/session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({}),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Dodo portal error:", res.status, errBody);
      return NextResponse.json(
        { error: "Failed to open billing portal" },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json({ url: data.link });
  } catch (err) {
    console.error("Dodo portal exception:", err);
    return NextResponse.json(
      { error: "Billing service unavailable" },
      { status: 502 },
    );
  }
}
