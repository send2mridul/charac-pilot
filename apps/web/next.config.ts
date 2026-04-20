import type { NextConfig } from "next";
import path from "path";

/**
 * Monorepo root. `npm run dev -w web` usually cwd=apps/web; running from repo root uses cwd=characpilot.
 */
function getRepoRoot(): string {
  const cwd = process.cwd();
  return path.basename(cwd) === "web"
    ? path.join(cwd, "..", "..")
    : cwd;
}

/** Same rules as lib/api/config.ts — empty env must not inline as "". */
function resolvePublicApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (raw == null || raw.trim() === "") {
    return "http://127.0.0.1:8000";
  }
  return raw.trim().replace(/\/+$/, "");
}

const nextConfig: NextConfig = {
  transpilePackages: ["@characpilot/shared"],
  outputFileTracingRoot: getRepoRoot(),
  env: {
    NEXT_PUBLIC_API_BASE_URL: resolvePublicApiBaseUrl(),
  },
  /** Config-level redirect avoids a separate RSC payload for `/` (fewer stale-chunk 500s in dev). */
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
