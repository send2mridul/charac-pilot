import { getDb } from "./neon";

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  auth_provider: string;
  plan: string;
  dodo_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
  return (rows[0] as AppUser) ?? null;
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return (rows[0] as AppUser) ?? null;
}

export async function upsertUser(params: {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  auth_provider?: string;
}): Promise<AppUser> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO users (id, email, name, avatar_url, auth_provider)
    VALUES (${params.id}, ${params.email}, ${params.name ?? null}, ${params.avatar_url ?? null}, ${params.auth_provider ?? "google"})
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0] as AppUser;
}
