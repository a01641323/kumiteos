// PUT /api/request/[id]/bundle
//
// Autosave the wizard's in-progress tournament bundle. Cookie-gated;
// only the original requester can write. Body: { bundle: <partial bundle> }.
// Validates in partial mode and persists under the draft key.

import { NextRequest, NextResponse } from "next/server";
import { authorizeAccess, patchRequestContact } from "@/lib/requests";
import { storeRequestBundle, validateBundle, bundleByteSize } from "@/lib/bundle";
import { decodeRequestCookie, REQUEST_COOKIE } from "@/lib/cookie";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const cookieVal = req.cookies.get(REQUEST_COOKIE.name)?.value;
  const token = decodeRequestCookie(cookieVal)?.accessToken;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const record = await authorizeAccess(id, token);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (record.status !== "draft" && record.status !== "rejected") {
    return NextResponse.json({ error: `locked_${record.status}` }, { status: 409 });
  }

  let body: { bundle?: unknown; contact?: { email?: string; org?: string; tournamentDate?: string; notes?: string } };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (body.contact) {
    await patchRequestContact(id, body.contact);
  }

  if (body.bundle === undefined) {
    // contact-only patch
    return NextResponse.json({ ok: true, sizeBytes: 0 });
  }

  const v = validateBundle(body.bundle, { partial: true });
  if (!v.ok) return NextResponse.json({ error: "invalid_bundle", detail: v.error }, { status: 400 });
  const meta = await storeRequestBundle(id, v.bundle, v.sizeBytes);
  return NextResponse.json({ ok: true, sizeBytes: v.sizeBytes, meta, calcSizeBytes: bundleByteSize(v.bundle) });
}
