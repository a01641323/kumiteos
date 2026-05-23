// Cloud-side activation. The local app POSTs here with the 6-digit
// code + the requesting machine's fingerprint. We mint a single JWT,
// bind the code to the machine, and return the token. Subsequent
// activations of the same code on a different machine are rejected.

import { NextRequest, NextResponse } from "next/server";
import { findByCode, hashCode, markActivated } from "@/lib/tokens";
import { signLicenseJwt } from "@/lib/jwt";
import { deleteBundle, getBundle } from "@/lib/bundle";

export const runtime = "nodejs";

const CODE_RE = /^\d{6}$/;
const FP_RE = /^[a-f0-9]{16,128}$/i;

export async function POST(req: NextRequest) {
  let body: { code?: unknown; machineFingerprint?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const fp = typeof body.machineFingerprint === "string" ? body.machineFingerprint.trim() : "";

  if (!CODE_RE.test(code)) return NextResponse.json({ error: "CODE_NOT_FOUND" }, { status: 400 });
  if (!FP_RE.test(fp)) return NextResponse.json({ error: "INVALID_FINGERPRINT" }, { status: 400 });

  const record = await findByCode(code);
  if (!record) return NextResponse.json({ error: "CODE_NOT_FOUND" }, { status: 404 });

  if (record.status === "revoked") return NextResponse.json({ error: "ACCESS_REVOKED" }, { status: 403 });
  if (record.expiresAt < Date.now()) return NextResponse.json({ error: "CODE_EXPIRED" }, { status: 410 });

  if (record.status === "used") {
    if (record.machineFingerprint !== fp) {
      return NextResponse.json({ error: "CODE_ALREADY_USED" }, { status: 409 });
    }
    // Same machine reactivating — issue a fresh JWT bound to the same jti lineage.
  }

  const ttlSeconds = record.ttlHours * 60 * 60;
  const { token, claims } = await signLicenseJwt({
    codeId: record.codeId,
    machineFingerprint: fp,
    ttlSeconds,
  });
  await markActivated(hashCode(code), fp, claims.jti);

  // One-shot bundle delivery. If the admin attached a tournament
  // bundle to this code, hand it back exactly once and then drop the
  // KV entry — the binary now owns the only copy. Same-machine
  // re-activation deliberately does NOT redeliver because the local
  // state would already be in place; redelivery would clobber any
  // scoring the operator did.
  let bundle = null;
  try {
    if (record.status !== "used") {
      bundle = await getBundle(record.codeId);
      if (bundle) await deleteBundle(record.codeId);
    }
  } catch {
    // Don't fail activation just because bundle delivery hit a snag —
    // the operator can still configure the tournament manually.
  }

  return NextResponse.json({
    token,
    payload: {
      sub: claims.sub,
      role: claims.role,
      features: claims.features,
      plan: claims.plan,
      activated_at: claims.activated_at,
      exp: claims.exp,
      iat: claims.iat as number,
      jti: claims.jti,
    },
    ...(bundle ? { bundle } : {}),
  });
}
