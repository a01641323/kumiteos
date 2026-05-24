import { NextResponse } from "next/server";
import { getRequest, markGranted } from "@/lib/requests";
import { mintCode } from "@/lib/tokens";
import { requireSuperadmin } from "@/lib/admin-guard";
import {
  storeBundle, validateBundle, getRequestBundle, deleteRequestBundle, bundleByteSize,
} from "@/lib/bundle";
import { auth } from "@/auth";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: RouteContext) {
  const denied = await requireSuperadmin();
  if (denied) return denied;

  const { id } = await ctx.params;
  const cur = await getRequest(id);
  if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cur.status !== "pending") {
    return NextResponse.json({ error: `already_${cur.status}` }, { status: 409 });
  }

  // Pull the in-progress bundle the client autosaved during the wizard.
  // Legacy requests (created before the wizard shipped) won't have one
  // — those grant fine without a bundle.
  const draftBundle = await getRequestBundle(id);
  let validation: ReturnType<typeof validateBundle> | null = null;
  if (draftBundle) {
    validation = validateBundle(draftBundle, { partial: false });
    if (!validation.ok) {
      return NextResponse.json({ error: "invalid_bundle", detail: validation.error }, { status: 400 });
    }
  }

  const session = await auth();
  const decidedBy = (session?.user as { id?: string })?.id ?? session?.user?.email ?? undefined;

  const { code, record } = await mintCode({ requestId: id });
  const next = await markGranted(id, record.codeId, code, decidedBy);
  if (!next) return NextResponse.json({ error: "race_lost" }, { status: 409 });

  if (validation && validation.ok) {
    try {
      await storeBundle(record.codeId, validation.bundle, validation.sizeBytes);
      await deleteRequestBundle(id);
    } catch (err) {
      return NextResponse.json({
        ok: true,
        codeId: record.codeId,
        bundleAttached: false,
        bundleError: (err as Error).message,
        sizeBytes: bundleByteSize(validation.bundle),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    codeId: record.codeId,
    bundleAttached: !!validation,
  });
}
