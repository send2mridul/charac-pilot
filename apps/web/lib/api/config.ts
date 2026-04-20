const DEFAULT_API_BASE = "http://127.0.0.1:8000";

/**
 * Empty string in .env (NEXT_PUBLIC_API_BASE_URL=) is truthy for ?? but must not be used —
 * otherwise fetch hits the Next origin (localhost:3000) and /episodes/... returns 404.
 */
function normalizeApiBaseUrl(raw: string | undefined): string {
  if (raw == null) return DEFAULT_API_BASE;
  const t = raw.trim();
  if (t === "") return DEFAULT_API_BASE;
  return t.replace(/\/+$/, "");
}

export function getPublicApiBaseUrl(): string {
  return normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
}
