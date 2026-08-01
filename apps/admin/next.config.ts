import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Baseline security headers for every response. The page CSP is NOT set
 * here: pages get a per-request nonce-based CSP from src/proxy.ts (Next.js
 * hydration relies on inline bootstrap scripts, which need a nonce). API
 * routes return JSON only, so they get a fully locked-down static CSP.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const apiCsp = "default-src 'none'; frame-ancestors 'none'";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: [
    "@zts/database",
    "@zts/auth",
    "@zts/security",
    "@zts/matrix",
    "@zts/automation",
    "@zts/integrations",
    "@zts/ai",
  ],
  serverExternalPackages: ["argon2", "postgres", "ioredis", "pino", "bullmq"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/api/(.*)",
        headers: [{ key: "Content-Security-Policy", value: apiCsp }],
      },
    ];
  },
};

export default nextConfig;
