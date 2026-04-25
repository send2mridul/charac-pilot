import { getDb } from "./neon";

export interface Subscription {
  id: string;
  user_id: string;
  dodo_subscription_id: string | null;
  dodo_product_id: string | null;
  plan: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getActiveSubscription(
  userId: string,
): Promise<Subscription | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM subscriptions
    WHERE user_id = ${userId} AND status IN ('active', 'trialing')
    ORDER BY created_at DESC LIMIT 1
  `;
  return (rows[0] as Subscription) ?? null;
}

export async function upsertSubscription(params: {
  id: string;
  user_id: string;
  dodo_subscription_id?: string | null;
  dodo_product_id?: string | null;
  plan: string;
  status: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at?: string | null;
}): Promise<Subscription> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO subscriptions (id, user_id, dodo_subscription_id, dodo_product_id, plan, status,
      current_period_start, current_period_end, cancel_at)
    VALUES (${params.id}, ${params.user_id}, ${params.dodo_subscription_id ?? null},
      ${params.dodo_product_id ?? null}, ${params.plan}, ${params.status},
      ${params.current_period_start ?? null}, ${params.current_period_end ?? null},
      ${params.cancel_at ?? null})
    ON CONFLICT (id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      dodo_subscription_id = EXCLUDED.dodo_subscription_id,
      dodo_product_id = EXCLUDED.dodo_product_id,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at = EXCLUDED.cancel_at,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0] as Subscription;
}

export async function cancelSubscription(subId: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE subscriptions SET status = 'canceled', cancel_at = NOW(), updated_at = NOW()
    WHERE id = ${subId}
  `;
}

export async function updateUserPlan(
  userId: string,
  plan: string,
): Promise<void> {
  const sql = getDb();
  await sql`UPDATE users SET plan = ${plan}, updated_at = NOW() WHERE id = ${userId}`;
}
