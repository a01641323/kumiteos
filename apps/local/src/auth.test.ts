import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { requireAuth, signLicenseToken, type AuthDeps, type SessionGuardHooks } from "./auth";
import { loadOrCreateKeys } from "./keys";
import { LicenseStore } from "./licenses";
import { defaultConfig } from "./config";

let dir: string;
let deps: AuthDeps;
let token: string;
let payloadSub: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-"));
  const keys = await loadOrCreateKeys(dir);
  const licenses = new LicenseStore(dir);
  deps = { config: defaultConfig({ dataDir: dir }), keys, licenses };
  const signed = await signLicenseToken(deps, {
    userId: "u_test",
    role: "referee",
    features: ["scoring"],
    plan: "referee",
    machineFingerprint: "abcdef0123456789",
    activatedAt: Math.floor(Date.now() / 1000),
  });
  token = signed.token;
  payloadSub = signed.payload.sub;
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function fakeRes() {
  return {
    statusCode: 0,
    body: null as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  };
}

function stubGuard(active: boolean, reason: "CLOCK_TAMPER" | "EXPIRED" | null = null): SessionGuardHooks & { observed: Array<[string, number, number]> } {
  const observed: Array<[string, number, number]> = [];
  return {
    observed,
    observe: (sub, iat, exp) => { observed.push([sub, iat, exp]); },
    isActive: () => active,
    lockReason: () => reason,
  };
}

describe("requireAuth guard enforcement", () => {
  it("passes and re-arms the guard when active", async () => {
    const guard = stubGuard(true);
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(deps, guard)(req, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.auth?.sub).toBe(payloadSub);
    expect(guard.observed.length).toBe(1);         // re-armed from the verified window
    expect(guard.observed[0]![0]).toBe(payloadSub);
  });

  it("rejects with the lock reason when the guard is locked", async () => {
    const guard = stubGuard(false, "CLOCK_TAMPER");
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(deps, guard)(req, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toBe("CLOCK_TAMPER");
    expect(guard.observed.length).toBe(1);         // still re-armed before the check
  });

  it("still works with no guard (backward compatible)", async () => {
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    await requireAuth(deps)(req, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.auth?.sub).toBe(payloadSub);
  });
});
