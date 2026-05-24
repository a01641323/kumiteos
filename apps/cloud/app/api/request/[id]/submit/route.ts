// POST /api/request/[id]/submit
//
// Flip a draft request to "pending" so it shows up in the admin queue.
// Requires a complete, validated bundle to already be stored.

import { NextRequest, NextResponse } from "next/server";
import { authorizeAccess, markSubmitted } from "@/lib/requests";
import { getRequestBundle, validateBundle } from "@/lib/bundle";
import { decodeRequestCookie, REQUEST_COOKIE } from "@/lib/cookie";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const cookieVal = req.cookies.get(REQUEST_COOKIE.name)?.value;
  const token = decodeRequestCookie(cookieVal)?.accessToken;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const record = await authorizeAccess(id, token);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (record.status !== "draft" && record.status !== "rejected") {
    return NextResponse.json({ error: `already_${record.status}` }, { status: 409 });
  }

  const bundle = await getRequestBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: "bundle_missing" }, { status: 400 });
  }
  const v = validateBundle(bundle, { partial: false });
  if (!v.ok) {
    return NextResponse.json({ error: "invalid_bundle", detail: v.error }, { status: 400 });
  }

  // If the request was previously rejected, allow re-submit by
  // resetting the row back to "draft" first so markSubmitted accepts.
  if (record.status === "rejected") {
    // Direct write: bypass markSubmitted's draft-only check.
    const { kv, keys } = await import("@/lib/kv");
    await kv.set(keys.request(id), {
      ...record,
      status: "draft",
      rejectionReason: null,
      reviewedAt: null,
    });
  }

  const next = await markSubmitted(id);
  if (!next) return NextResponse.json({ error: "race" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
