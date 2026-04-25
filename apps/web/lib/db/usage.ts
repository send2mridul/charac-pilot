import { getDb } from "./neon";
import { planLimits, type PlanLimits } from "../billing/plans";

export interface UsageCounters {
  user_id: string;
  period_start: string;
  period_end: string;
  projects_count: number;
  imports: number;
  media_seconds: number;
  storage_bytes: number;
  line_gens: number;
  preview_gens: number;
  voice_uploads: number;
}

function currentPeriodBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getOrCreateUsage(userId: string): Promise<UsageCounters> {
  const sql = getDb();
  const { start, end } = currentPeriodBounds();

  const existing = await sql`
    SELECT * FROM usage_counters
    WHERE user_id = ${userId} AND period_start = ${start}::timestamptz
    LIMIT 1
  `;
  if (existing.length > 0) return existing[0] as UsageCounters;

  const rows = await sql`
    INSERT INTO usage_counters (user_id, period_start, period_end)
    VALUES (${userId}, ${start}::timestamptz, ${end}::timestamptz)
    ON CONFLICT (user_id, period_start) DO NOTHING
    RETURNING *
  `;
  if (rows.length > 0) return rows[0] as UsageCounters;

  const fallback = await sql`
    SELECT * FROM usage_counters
    WHERE user_id = ${userId} AND period_start = ${start}::timestamptz
    LIMIT 1
  `;
  return (fallback[0] as UsageCounters) ?? {
    user_id: userId,
    period_start: start,
    period_end: end,
    projects_count: 0,
    imports: 0,
    media_seconds: 0,
    storage_bytes: 0,
    line_gens: 0,
    preview_gens: 0,
    voice_uploads: 0,
  };
}

type CounterField =
  | "projects_count"
  | "imports"
  | "media_seconds"
  | "storage_bytes"
  | "line_gens"
  | "preview_gens"
  | "voice_uploads";

export async function incrementUsage(
  userId: string,
  field: CounterField,
  amount: number = 1,
): Promise<void> {
  const sql = getDb();
  const { start, end } = currentPeriodBounds();

  await sql`
    INSERT INTO usage_counters (user_id, period_start, period_end)
    VALUES (${userId}, ${start}::timestamptz, ${end}::timestamptz)
    ON CONFLICT (user_id, period_start) DO NOTHING
  `;

  switch (field) {
    case "projects_count":
      await sql`UPDATE usage_counters SET projects_count = projects_count + ${amount} WHERE user_id = ${userId} AND period_start = ${start}::timestamptz`;
      break;
    case "imports":
      await sql`UPDATE usage_counters SET imports = imports + ${amount} WHERE user_id = ${userId} AND period_start = ${start}::timestamptz`;
      break;
    case "media_seconds":
      await sql`UPDATE usage_counters SET media_seconds = media_seconds + ${amount} WHERE user_id = ${userId} AND period_start = ${start}::timestamptz`;
      break;
    case "storage_bytes":
      await sql`UPDATE usage_counters SET storage_bytes = storage_bytes + ${amount} WHERE user_id = ${userId} AND period_start = ${start}::timestamptz`;
      break;
    case "line_gens":
      await sql`UPDATE usage_counters SET line_gens = line_gens + ${amount} WHERE user_id = ${userId} AND period_start = ${start}::timestamptz`;
      break;
    case "preview_gens":
      await sql`UPDATE usage_counters SET preview_gens = preview_gens + ${amount} WHERE user_id = ${userId} AND period_start = ${start}::timestamptz`;
      break;
    case "voice_uploads":
      await sql`UPDATE usage_counters SET voice_uploads = voice_uploads + ${amount} WHERE user_id = ${userId} AND period_start = ${start}::timestamptz`;
      break;
  }
}

export type QuotaCheckResult =
  | { allowed: true }
  | { allowed: false; field: string; used: number; limit: number; plan: string };

export async function checkQuota(
  userId: string,
  planId: string,
  field: CounterField,
  additionalAmount: number = 1,
): Promise<QuotaCheckResult> {
  const limits: PlanLimits = planLimits(planId);
  const usage = await getOrCreateUsage(userId);

  const limitMap: Record<CounterField, number> = {
    projects_count: limits.projects,
    imports: limits.imports_per_period,
    media_seconds: limits.transcription_minutes * 60,
    storage_bytes: limits.storage_bytes,
    line_gens: limits.line_gens,
    preview_gens: limits.preview_gens,
    voice_uploads: limits.voice_uploads,
  };

  const currentLimit = limitMap[field];
  const currentUsed = (usage as unknown as Record<string, number>)[field] ?? 0;

  if (currentUsed + additionalAmount > currentLimit) {
    return {
      allowed: false,
      field,
      used: currentUsed,
      limit: currentLimit,
      plan: planId,
    };
  }
  return { allowed: true };
}
