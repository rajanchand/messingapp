import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "zts_session";

/**
 * Builds the page CSP with a per-request script nonce. Next.js detects the
 * `content-security-policy` request header and applies the nonce to its
 * inline bootstrap scripts; 'strict-dynamic' then lets those scripts load
 * the hashed static chunks. A static `script-src 'self'` is NOT enough:
 * the App Router streams the RSC payload via inline scripts, and blocking
 * them leaves the page rendered but never hydrated (no interactivity).
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Page-level gate + CSP nonce injection. The auth redirect is a UX
 * optimization only - real session validation and RBAC happen server-side
 * in every API route.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSessionCookie = req.cookies.has(SESSION_COOKIE);

  if (pathname === "/login" && hasSessionCookie) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (pathname !== "/login" && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Pages only - API routes enforce auth themselves and return proper 401s,
  // and get a static locked-down CSP from next.config.ts instead.
  matcher: ["/((?!api|_next/static|_next/image|branding|favicon.ico).*)"],
};
