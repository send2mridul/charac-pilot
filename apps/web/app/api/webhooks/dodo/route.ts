import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { findUserByEmail } from "@/lib/db/users";
import { upsertSubscription, updateUserPlan } from "@/lib/db/subscriptions";
import { getDb } from "@/lib/db/neon";

/**
 * Dodo uses the Standard Webhooks spec:
 *   signed_content = `${webhook_id}.${webhook_timestamp}.${body}`
 *   signature      = base64( HMAC-SHA256( base64decode(secret), signed_content ) )
 *   header         = "v1,<signature>"
 *
 * The secret from the dashboard starts with "whsec_"; the real key is the
 * base64-encoded portion after that prefix.
 */
function verifySignature(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
): boolean {
  const rawSecret = process.env.DODO_WEBHOOK_SECRET;
  if (!rawSecret || !headers.id || !headers.timestamp || !headers.signature) {
    return false;
  }

  const secretBytes = Buffer.from(
    rawSecret.startsWith("whsec_") ? rawSecret.slice(6) : rawSecret,
    "base64",
  );

  const signedContent = `${headers.id}.${headers.timestamp}.${body}`;
  const computed = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  const sigs = headers.signature.split(" ");
  for (const versionedSig of sigs) {
    const parts = versionedSig.split(",");
    if (parts.length >= 2 && parts[0] === "v1") {
      const expected = parts.slice(1).join(",");
      try {
        if (
          crypto.timingSafeEqual(
            Buffer.from(computed),
            Buffer.from(expected),
          )
        ) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  return false;
}

function planFromProductId(productId: string | null): string {
  if (!productId) return "free";
  if (productId === process.env.NEXT_PUBLIC_DODO_PRO_MONTHLY_PRODUCT_ID)
    return "pro_monthly";
  if (productId === process.env.NEXT_PUBLIC_DODO_PRO_YEARLY_PRODUCT_ID)
    return "pro_yearly";
  return "free";
}

export async function POST(request: NextRequest) {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("DODO_WEBHOOK_SECRET not set; webhook ignored");
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const rawBody = await request.text();

  const sigHeaders = {
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
  };

  if (!verifySignature(rawBody, sigHeaders)) {
    console.error("Webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type as string;
  const data = event.data as Record<string, unknown> | undefined;

  if (!data) {
    return NextResponse.json({ received: true });
  }

  console.log(`Dodo webhook: ${eventType}`);

  try {
    if (
      eventType === "subscription.active" ||
      eventType === "subscription.created" ||
      eventType === "subscription.renewed"
    ) {
      await handleSubscriptionActive(data);
    } else if (
      eventType === "subscription.cancelled" ||
      eventType === "subscription.expired"
    ) {
      await handleSubscriptionCancelled(data);
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleSubscriptionActive(data: Record<string, unknown>) {
  const customer = data.customer as Record<string, string> | undefined;
  const email = customer?.email;
  const dodoSubId = (data.subscription_id as string) || "";
  const productId = (data.product_id as string) || null;
  const periodStart = (data.current_period_start as string) || null;
  const periodEnd = (data.current_period_end as string) || null;

  if (!email) {
    console.warn("Webhook subscription.active: no customer email in payload");
    return;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.warn(`Webhook: no user for email ${email}`);
    return;
  }

  const plan = planFromProductId(productId);

  await upsertSubscription({
    id: dodoSubId || crypto.randomUUID(),
    user_id: user.id,
    dodo_subscription_id: dodoSubId,
    dodo_product_id: productId,
    plan,
    status: "active",
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });

  await updateUserPlan(user.id, plan);

  const dodoCustomerId = customer?.customer_id;
  if (dodoCustomerId) {
    const sql = getDb();
    await sql`UPDATE users SET dodo_customer_id = ${dodoCustomerId}, updated_at = NOW() WHERE id = ${user.id}`;
  }

  console.log(
    `Webhook: user ${user.id} upgraded to ${plan} (sub: ${dodoSubId})`,
  );
}

async function handleSubscriptionCancelled(data: Record<string, unknown>) {
  const customer = data.customer as Record<string, string> | undefined;
  const email = customer?.email;
  if (!email) return;

  const user = await findUserByEmail(email);
  if (!user) return;

  const dodoSubId = (data.subscription_id as string) || "";

  await upsertSubscription({
    id: dodoSubId || crypto.randomUUID(),
    user_id: user.id,
    dodo_subscription_id: dodoSubId,
    plan: "free",
    status: "canceled",
  });

  await updateUserPlan(user.id, "free");

  console.log(`Webhook: user ${user.id} downgraded to free (sub cancelled)`);
}
