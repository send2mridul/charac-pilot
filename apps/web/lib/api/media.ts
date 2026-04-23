import { getPublicApiBaseUrl } from "./config";

/** Build absolute URL for a file served at GET /media/{relativePath}. */
export function mediaUrl(relativePath: string): string {
  const base = getPublicApiBaseUrl().replace(/\/$/, "");
  const p = relativePath.replace(/^\/+/, "");
  return `${base}/media/${p}`;
}

/** Same as mediaUrl but avoids stale browser cache when the same path is overwritten. */
export function mediaUrlWithCacheBust(
  relativePath: string,
  bust?: string | null,
): string {
  const u = mediaUrl(relativePath);
  if (!bust) return u;
  const token = encodeURIComponent(bust);
  return u.includes("?") ? `${u}&v=${token}` : `${u}?v=${token}`;
}
