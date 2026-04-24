import { getPublicApiBaseUrl } from "./config";
import { getApiAuthToken } from "./client";

function _appendToken(url: string): string {
  const token = getApiAuthToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/** Build absolute URL for a file served at GET /media/{relativePath}. */
export function mediaUrl(relativePath: string): string {
  const base = getPublicApiBaseUrl().replace(/\/$/, "");
  const p = relativePath.replace(/^\/+/, "");
  return _appendToken(`${base}/media/${p}`);
}

/** Same as mediaUrl but avoids stale browser cache when the same path is overwritten. */
export function mediaUrlWithCacheBust(
  relativePath: string,
  bust?: string | null,
): string {
  const base = getPublicApiBaseUrl().replace(/\/$/, "");
  const p = relativePath.replace(/^\/+/, "");
  let u = `${base}/media/${p}`;
  if (bust) {
    u += `?v=${encodeURIComponent(bust)}`;
  }
  return _appendToken(u);
}
