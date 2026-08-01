import { NextResponse } from "next/server";

/** Liveness probe. No dependencies checked, no sensitive data. */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
