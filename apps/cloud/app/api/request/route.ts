// POST /api/request
//
// Create a *draft* token request from the wizard's contact step.
// Returns { requestId, accessToken } and sets the karate.request
// cookie so the client can keep autosaving the attached bundle
// without exposing the in-progress data to the admin queue.
//
// The legacy /api/request-token endpoint still exists and creates
// requests directly in "pending" status; this new endpoint is the
// only path that opens with status="draft".

import { NextRequest, NextResponse } from "next/server";
import { createRequest } from "@/lib/requests";
import { encodeRequestCookie, REQUEST_COOKIE } from "@/lib/cookie";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: { email?: unknown; org?: unknown; tournamentDate?: unknown; notes?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const safeStr = (v: unknown, max: number) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const { id, accessToken } = await createRequest({
    email,
    org: safeStr(body.org, 200),
    tournamentDate: safeStr(body.tournamentDate, 50),
    notes: safeStr(body.notes, 1000),
    status: "draft",
  });

  const res = NextResponse.json({ requestId: id, accessToken });
  res.cookies.set({
    name: REQUEST_COOKIE.name,
    value: encodeRequestCookie({ requestId: id, accessToken }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REQUEST_COOKIE.maxAge,
  });
  return res;
}
