import { getPublicApiBaseUrl } from "./config";

/** Build absolute URL for a file served at GET /media/{relativePath}. */
export function mediaUrl(relativePath: string): string {
  const base = getPublicApiBaseUrl().replace(/\/$/, "");
  const p = relativePath.replace(/^\/+/, "");
  return `${base}/media/${p}`;
}
