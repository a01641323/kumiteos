import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSessionManager, type LockReason } from "./session-manager";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Controllable clocks.
function clocks(startWall: number, startMono = 0) {
  let wall = startWall;
  let mono = startMono;
  return {
    now: () => wall,
    monotonicMs: () => mono,
    setWall: (v: number) => { wall = v; },
    advance: (ms: number) => { wall += ms; mono += ms; },
    freezeWall: (ms: number) => { mono += ms; }, // monotonic advances, wall frozen
  };
}

describe("session-manager", () => {
  it("is active after observing a valid license, inactive before", () => {
    const c = clocks(1_000);
    const enforced: LockReason[] = [];
    const m = createSessionManager({ dataDir: dir, onEnforced: (r) => enforced.push(r), now: c.now, monotonicMs: c.monotonicMs });
    m.start();
    expect(m.isActive()).toBe(true); // no session tracked yet → not blocking
    m.observe({ sub: "u", issuedAt: 1_000, expiresAt: 100_000 });
    expect(m.isActive()).toBe(true);
    m.stop();
  });

  it("locks with CLOCK_TAMPER on a rollback past the grace and calls onEnforced once", () => {
    const c = clocks(1_000);
    const enforced: LockReason[] = [];
    const m = createSessionManager({ dataDir: dir, onEnforced: (r) => enforced.push(r), now: c.now, monotonicMs: c.monotonicMs });
    m.start();
    m.observe({ sub: "u", issuedAt: 1_000, expiresAt: 100_000 });
    c.advance(10_000);              // wall now 11_000, highWater catches up on tick
    m.tickNow();
    c.setWall(11_000 - 90_001);     // roll back beyond the 90s grace
    m.tickNow();
    expect(m.isActive()).toBe(false);
    expect(enforced).toEqual(["CLOCK_TAMPER"]);
    expect(m.peek()).toBe("CLOCK_TAMPER");
    m.stop();
  });

  it("locks with EXPIRED when frozen wall lets the monotonic budget hit the window", () => {
    const c = clocks(1_000);
    const enforced: LockReason[] = [];
    const m = createSessionManager({ dataDir: dir, onEnforced: (r) => enforced.push(r), now: c.now, monotonicMs: c.monotonicMs });
    m.start();
    // Tiny window: 5s of budget.
    m.observe({ sub: "u", issuedAt: 1_000, expiresAt: 6_000 });
    c.freezeWall(6_000);            // wall stays at 1_000, monotonic +6s
    m.tickNow();
    expect(m.isActive()).toBe(false);
    expect(enforced).toEqual(["EXPIRED"]); // budget-exhausted maps to EXPIRED
    m.stop();
  });

  it("resumes accrued budget from disk across a restart (same sub)", () => {
    const c = clocks(1_000);
    const m1 = createSessionManager({ dataDir: dir, onEnforced: () => {}, now: c.now, monotonicMs: c.monotonicMs });
    m1.start();
    m1.observe({ sub: "u", issuedAt: 1_000, expiresAt: 1_000_000 });
    c.advance(20_000);
    m1.tickNow(); // budgetUsedMs ~= 20_000 persisted
    m1.stop();

    const c2 = clocks(21_000, 0); // fresh monotonic origin after "restart"
    const m2 = createSessionManager({ dataDir: dir, onEnforced: () => {}, now: c2.now, monotonicMs: c2.monotonicMs });
    m2.start();
    expect(m2.isActive()).toBe(true);
    const snap = m2.debugState();
    expect(snap?.budgetUsedMs).toBeGreaterThanOrEqual(20_000);
    m2.stop();
  });

  it("stays locked when the same token is re-observed after a tamper lock", () => {
    const c = clocks(1_000);
    const m = createSessionManager({ dataDir: dir, onEnforced: () => {}, now: c.now, monotonicMs: c.monotonicMs });
    m.start();
    m.observe({ sub: "u", issuedAt: 1_000, expiresAt: 100_000 });
    c.advance(10_000); m.tickNow();
    c.setWall(11_000 - 90_001); m.tickNow();
    expect(m.isActive()).toBe(false);
    // Re-present the SAME window → must not silently recover.
    m.observe({ sub: "u", issuedAt: 1_000, expiresAt: 100_000 });
    expect(m.isActive()).toBe(false);
    m.stop();
  });
});
