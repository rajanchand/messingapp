import { NextResponse } from "next/server";

const VERSION = process.env.APP_VERSION ?? "0.1.0";

export function GET() {
  return NextResponse.json({ version: VERSION });
}
