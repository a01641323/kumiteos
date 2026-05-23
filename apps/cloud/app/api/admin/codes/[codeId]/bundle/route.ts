// Bundle replace + metadata for the /admin/codes UI.
//
// PUT — replace the bundle attached to a code. Only allowed while the
// code is "unused"; once activated, the bundle is already in the
// customer's binary and replacing it on the cloud would do nothing.
//
// GET — return the bundle metadata (size, label, counts). NOT the
// bundle itself — the JSON would be too heavy for the table view
// and the admin already has a copy on disk anyway.

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/admin-guard";
import { findByCodeId } from "@/lib/tokens";
import { getBundleMeta, storeBundle, validateBundle } from "@/lib/bundle";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ codeId: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const denied = await requireSuperadmin();
  if (denied) return denied;
  const { codeId } = await ctx.params;
  const meta = await getBundleMeta(codeId);
  return NextResponse.json({ meta });
}

export async function PUT(req: Request, ctx: RouteContext) {
  const denied = await requireSuperadmin();
  if (denied) return denied;
  const { codeId } = await ctx.params;

  const code = await findByCodeId(codeId);
  if (!code) return NextResponse.json({ error: "code_not_found" }, { status: 404 });
  if (code.status !== "unused") {
    return NextResponse.json(
      { error: "already_activated", status: code.status },
      { status: 409 },
    );
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const bundleInput = (body as { bundle?: unknown })?.bundle;
  if (!bundleInput) return NextResponse.json({ error: "missing_bundle" }, { status: 400 });

  const v = validateBundle(bundleInput);
  if (!v.ok) return NextResponse.json({ error: "invalid_bundle", detail: v.error }, { status: 400 });

  const meta = await storeBundle(codeId, v.bundle, v.sizeBytes);
  return NextResponse.json({ ok: true, meta });
}
