import { NextRequest, NextResponse } from "next/server";
import { kv, keys } from "@/lib/kv";

export const runtime = "nodejs";

// This endpoint is polled cross-origin by every running customer
// binary (renderer at http://localhost:4747 → cloud). The browser
// drops responses without Access-Control-Allow-Origin, which would
// silently break the 5-minute revoke heartbeat. We allow any origin
// because the response carries no secret — `{ revoked: boolean }`
// for an opaque, unguessable UUID.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const jti = req.nextUrl.searchParams.get("jti")?.trim();
  if (!jti) {
    return NextResponse.json({ error: "missing_jti" }, { status: 400, headers: CORS_HEADERS });
  }
  const revoked = (await kv.get<string>(keys.jtiRevoked(jti))) === "1";
  return NextResponse.json({ revoked }, { headers: CORS_HEADERS });
}
