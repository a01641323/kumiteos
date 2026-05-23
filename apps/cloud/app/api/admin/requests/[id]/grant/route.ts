import { NextResponse } from "next/server";
import { getRequest, markGranted } from "@/lib/requests";
import { mintCode } from "@/lib/tokens";
import { requireSuperadmin } from "@/lib/admin-guard";
import { storeBundle, validateBundle } from "@/lib/bundle";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const denied = await requireSuperadmin();
  if (denied) return denied;

  const { id } = await ctx.params;
  const cur = await getRequest(id);
  if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cur.status !== "pending") {
    return NextResponse.json({ error: `already_${cur.status}` }, { status: 409 });
  }

  // Optional bundle in the body. If a body was sent, parse it; null
  // body → unattached grant (legacy flow, still supported).
  let bundleInput: unknown = null;
  try {
    const text = await req.text();
    if (text && text.trim().length > 0) {
      const parsed = JSON.parse(text);
      bundleInput = parsed?.bundle ?? null;
    }
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let bundleValidation: ReturnType<typeof validateBundle> | null = null;
  if (bundleInput) {
    bundleValidation = validateBundle(bundleInput);
    if (!bundleValidation.ok) {
      return NextResponse.json({ error: "invalid_bundle", detail: bundleValidation.error }, { status: 400 });
    }
  }

  const { code, record } = await mintCode({ requestId: id });
  const next = await markGranted(id, record.codeId, code);
  if (!next) return NextResponse.json({ error: "race_lost" }, { status: 409 });

  if (bundleValidation && bundleValidation.ok) {
    try {
      await storeBundle(record.codeId, bundleValidation.bundle, bundleValidation.sizeBytes);
    } catch (err) {
      // Bundle persistence failed AFTER the code was minted. Return
      // success so the operator can still use the code, but flag.
      return NextResponse.json({
        ok: true,
        codeId: record.codeId,
        bundleAttached: false,
        bundleError: (err as Error).message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    codeId: record.codeId,
    bundleAttached: !!bundleValidation,
  });
}
