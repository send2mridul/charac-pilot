import { SignJWT } from "jose";
import { auth } from "@/auth";
import { getPublicApiBaseUrl } from "./config";
import { ApiError } from "./errors";

function _getSecret() {
  const s = process.env.API_AUTH_SECRET;
  if (!s) return null;
  return new TextEncoder().encode(s);
}

async function _serverToken(): Promise<string | null> {
  const secret = _getSecret();
  if (!secret) return null;
  const session = await auth();
  if (!session?.user?.email) return null;
  return new SignJWT({ sub: session.user.email, name: session.user.name || "" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function serverFetchJson<T>(path: string): Promise<T> {
  const url = `${getPublicApiBaseUrl()}${path}`;
  const headers: Record<string, string> = {};
  const token = await _serverToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { cache: "no-store", headers });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(`API ${res.status} for ${path}`, res.status, text);
  }
  return (text ? JSON.parse(text) : null) as T;
}
