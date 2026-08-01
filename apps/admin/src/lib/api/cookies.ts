import "server-only";
import type { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export const SESSION_COOKIE = "zts_session";
export const MFA_PENDING_COOKIE = "zts_mfa";

function secure(): boolean {
  return getEnv().NODE_ENV === "production";
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function setMfaPendingCookie(res: NextResponse, value: string, maxAgeSeconds: number): void {
  res.cookies.set(MFA_PENDING_COOKIE, value, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    // Only ever needed by the MFA verification endpoint.
    path: "/api/auth",
    maxAge: maxAgeSeconds,
  });
}

export function clearMfaPendingCookie(res: NextResponse): void {
  res.cookies.set(MFA_PENDING_COOKIE, "", {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
}
