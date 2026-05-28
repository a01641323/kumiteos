import { NextResponse } from "next/server";
import { purgeInactiveCodes } from "@/lib/tokens";
import { requireSuperadmin } from "@/lib/admin-guard";

export const runtime = "nodejs";
// Force dynamic: this handler reads the auth session cookie via auth().
// Without this, Next can statically optimize a request-less POST() and
// auth() evaluates with no request scope → always "unauthorized".
export const dynamic = "force-dynamic";

// Bulk-delete every code that is already revoked or expired, reclaiming
// the KV storage they and their attached bundles occupy.
export async function POST(_req: Request) {
  const denied = await requireSuperadmin();
  if (denied) return denied;
  const { deleted } = await purgeInactiveCodes();
  return NextResponse.json({ ok: true, deleted });
}
