import { getPublicApiBaseUrl } from "./config";
import { ApiError } from "./errors";

export async function serverFetchJson<T>(path: string): Promise<T> {
  const url = `${getPublicApiBaseUrl()}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(`API ${res.status} for ${path}`, res.status, text);
  }
  return (text ? JSON.parse(text) : null) as T;
}
