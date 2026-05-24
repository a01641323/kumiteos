// DELETE /api/request/[id]
//
// Wipe a draft request and its bundle. Used by the wizard's
// "empezar de cero" link. Only allowed while the request is still
// a draft (after submit the admin is the only one who can move it).

import { NextRequest, NextResponse } from "next/server";
import { authorizeAccess, deleteRequest } from "@/lib/requests";
import { deleteRequestBundle } from "@/lib/bundle";
import { decodeRequestCookie, REQUEST_COOKIE } from "@/lib/cookie";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const cookieVal = req.cookies.get(REQUEST_COOKIE.name)?.value;
  const token = decodeRequestCookie(cookieVal)?.accessToken;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const record = await authorizeAccess(id, token);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (record.status !== "draft" && record.status !== "rejected") {
    return NextResponse.json({ error: `cannot_delete_${record.status}` }, { status: 409 });
  }
  await deleteRequestBundle(id);
  await deleteRequest(id);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(REQUEST_COOKIE.name);
  return res;
}
