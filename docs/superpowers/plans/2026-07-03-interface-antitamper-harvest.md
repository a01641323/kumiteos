# Offline Anti-Tamper Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `interface` template's offline clock-tamper defense (monotonic budget + high-water mark + HMAC-sealed session file) into `apps/local`, so the host's Kumite/OS license can no longer be extended by rolling back or freezing the system clock while offline.

**Architecture:** The long-running `apps/local` Express server becomes the authority on the host license's offline window. Three new modules: `sealed-session.ts` (HMAC-sealed persistence, port of `interface/cli/lib/sealed-store.mjs`), `session-guard.ts` (pure policy, port of `interface/cli/lib/clock-guard.mjs`), and `session-manager.ts` (runtime that ticks every 5s, accumulates monotonic budget via `process.hrtime.bigint()`, advances the high-water mark, and fires an enforcement callback). The manager plugs into the existing `NetworkController.isHostLicensed` / `disconnectAll` seams; on a failing verdict it force-drops all LAN clients (the one harvested realtime pattern) and exposes a lock reason the web UI reads.

**Tech Stack:** TypeScript, Node `crypto` (HMAC-SHA256, `timingSafeEqual`), Node `fs`, Express, `ws`, Vitest 2.x.

**Scope note:** This plan implements ONLY the offline anti-tamper subsystem plus its required realtime propagation. Code-administration and self-update are intentionally untouched (existing implementations are already superior — see the spec). Do not modify `apps/cloud` or the update flow.

**Key facts established during design (do not re-litigate):**
- `packages/core/src/auth-types.ts:45` already declares `CLOCK_TAMPER` in `LicenseDegradedReason` but nothing ever produces it. We finally produce it.
- There is **no** license renewal (`/api/renew-token` was removed, `routes.ts:281`). The window is fixed at activation.
- The web app (`apps/web`) is served from the same origin as the local server in the shipping product, so same-origin `fetch("/api/session/status")` works from the browser.

---

### Task 1: Add a Vitest runner to `apps/local`

`apps/local` currently has no test runner. Mirror `packages/core`'s setup exactly.

**Files:**
- Modify: `apps/local/package.json`
- Create: `apps/local/vitest.config.ts`

- [ ] **Step 1: Add the `test` scripts and Vitest devDependency**

In `apps/local/package.json`, add two scripts to the `"scripts"` block (place after `"typecheck"`):

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

And add to `"devDependencies"` (keep alphabetical-ish, place after `"typescript"`):

```json
    "vitest": "^2.1.0"
```

- [ ] **Step 2: Create the Vitest config**

Create `apps/local/vitest.config.ts` with exactly:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: completes; `vitest` resolves in `apps/local`.

- [ ] **Step 4: Verify the runner works (no tests yet)**

Run: `pnpm --filter @karate/local test`
Expected: Vitest runs and reports "No test files found" (exit 0 or the standard no-tests message). This confirms the runner is wired.

- [ ] **Step 5: Commit**

```bash
git add apps/local/package.json apps/local/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(local): add vitest runner"
```

---

### Task 2: `sealed-session.ts` — HMAC-sealed persistence

Port of `interface/cli/lib/sealed-store.mjs` to TypeScript. Reuses `ensureDir` from `apps/local/src/storage.ts`. Stores files under `dataDir/keys/` next to the existing Ed25519 material.

**Files:**
- Create: `apps/local/src/sealed-session.ts`
- Test: `apps/local/src/sealed-session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/local/src/sealed-session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  seal,
  unseal,
  loadInstallKey,
  readState,
  writeState,
  deleteState,
  STATE_FILE,
  type SealedSessionState,
} from "./sealed-session";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sealed-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const sample: SealedSessionState = {
  sub: "u_123",
  issuedAt: 1000,
  expiresAt: 5000,
  highWater: 2000,
  budgetUsedMs: 500,
};

describe("sealed-session", () => {
  it("seals and unseals a round trip", () => {
    const key = loadInstallKey(dir);
    const container = seal(sample, key);
    expect(unseal(container, key)).toEqual(sample);
  });

  it("rejects a tampered payload (any byte change breaks the MAC)", () => {
    const key = loadInstallKey(dir);
    const container = seal(sample, key);
    container.payload.budgetUsedMs = 0; // hand-edit
    expect(unseal(container, key)).toBeNull();
  });

  it("rejects a wrong key", () => {
    const container = seal(sample, loadInstallKey(dir));
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "sealed2-"));
    const wrongKey = loadInstallKey(otherDir);
    expect(unseal(container, wrongKey)).toBeNull();
    fs.rmSync(otherDir, { recursive: true, force: true });
  });

  it("loadInstallKey is stable across calls and 64 hex chars", () => {
    const a = loadInstallKey(dir);
    const b = loadInstallKey(dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writeState then readState returns the payload", () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, sample);
    expect(readState(dir, key)).toEqual(sample);
  });

  it("readState deletes the file and returns null on integrity failure", () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, sample);
    const file = path.join(dir, "keys", STATE_FILE);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw.payload.budgetUsedMs = 999999; // corrupt on disk
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(readState(dir, key)).toBeNull();
    expect(fs.existsSync(file)).toBe(false); // deleted on sight
  });

  it("deleteState removes the file", () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, sample);
    deleteState(dir);
    expect(readState(dir, key)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @karate/local exec vitest run src/sealed-session.test.ts`
Expected: FAIL — cannot resolve `./sealed-session`.

- [ ] **Step 3: Write the implementation**

Create `apps/local/src/sealed-session.ts`:

```ts
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "./storage";

// All persisted session state (identity + clock high-water mark + monotonic
// budget) lives in ONE file, sealed with an HMAC keyed by a per-install random
// key. Hand-editing any byte invalidates the whole thing. Ported from the
// interface template's cli/lib/sealed-store.mjs. See docs SECURITY notes for
// what this does NOT prevent (a local attacker can read the key and re-seal).

export const KEY_FILE = "install-key";
export const STATE_FILE = "session.json";

export interface SealedSessionState {
  /** Stable license identity (JWT `sub`); survives across restarts. */
  sub: string;
  /** ms — start of the granted window (JWT iat). */
  issuedAt: number;
  /** ms — end of the granted window (JWT exp + offline grace). */
  expiresAt: number;
  /** ms — newest wall-clock time ever observed. */
  highWater: number;
  /** ms — accumulated monotonic runtime. */
  budgetUsedMs: number;
}

export interface Sealed<T> {
  payload: T;
  mac: string;
}

function keysDir(dataDir: string): string {
  return path.join(dataDir, "keys");
}

export function seal<T>(payload: T, keyHex: string): Sealed<T> {
  const body = JSON.stringify(payload);
  const mac = createHmac("sha256", Buffer.from(keyHex, "hex")).update(body).digest("hex");
  return { payload, mac };
}

export function unseal<T>(container: Sealed<T> | null | undefined, keyHex: string): T | null {
  if (!container || typeof container !== "object") return null;
  if (container.payload === undefined || typeof container.mac !== "string") return null;
  const body = JSON.stringify(container.payload);
  const expected = createHmac("sha256", Buffer.from(keyHex, "hex")).update(body).digest("hex");
  const actual = Buffer.from(container.mac);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  return container.payload;
}

// Created here on first run; the key protects against hand-editing, not
// against reading (mode 600).
export function loadInstallKey(dataDir: string): string {
  const dir = keysDir(dataDir);
  const file = path.join(dir, KEY_FILE);
  try {
    const key = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(key)) return key;
  } catch {
    /* missing or unreadable → regenerate */
  }
  const key = randomBytes(32).toString("hex");
  ensureDir(dir);
  fs.writeFileSync(file, key + "\n", { mode: 0o600 });
  return key;
}

export function readState(dataDir: string, keyHex: string): SealedSessionState | null {
  const file = path.join(keysDir(dataDir), STATE_FILE);
  let container: Sealed<SealedSessionState>;
  try {
    container = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const payload = unseal(container, keyHex);
  if (!payload) {
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } // integrity failure → delete on sight
    return null;
  }
  return payload;
}

export function writeState(dataDir: string, keyHex: string, payload: SealedSessionState): void {
  const dir = keysDir(dataDir);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(seal(payload, keyHex)));
}

export function deleteState(dataDir: string): void {
  try { fs.rmSync(path.join(keysDir(dataDir), STATE_FILE), { force: true }); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @karate/local exec vitest run src/sealed-session.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/local/src/sealed-session.ts apps/local/src/sealed-session.test.ts
git commit -m "feat(local): HMAC-sealed session persistence"
```

---

### Task 3: `session-guard.ts` — pure enforcement policy

Port of `interface/cli/lib/clock-guard.mjs`. Pure function, no I/O.

**Files:**
- Create: `apps/local/src/session-guard.ts`
- Test: `apps/local/src/session-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/local/src/session-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateSession, CLOCK_GRACE_MS, type SealedSessionState } from "./session-guard";

function state(over: Partial<SealedSessionState> = {}): SealedSessionState {
  return { sub: "u", issuedAt: 0, expiresAt: 10_000, highWater: 1_000, budgetUsedMs: 0, ...over };
}

describe("evaluateSession", () => {
  it("is active inside the window with budget remaining", () => {
    const v = evaluateSession(state(), 2_000);
    expect(v.status).toBe("active");
    if (v.status === "active") {
      expect(v.remainingWallMs).toBe(8_000);
      expect(v.remainingBudgetMs).toBe(10_000);
    }
  });

  it("expires when now >= expiresAt", () => {
    expect(evaluateSession(state(), 10_000).status).toBe("expired");
    expect(evaluateSession(state(), 12_000).status).toBe("expired");
  });

  it("is budget-exhausted when accumulated runtime reaches the window", () => {
    const v = evaluateSession(state({ budgetUsedMs: 10_000 }), 2_000);
    expect(v.status).toBe("budget-exhausted");
  });

  it("detects a clock rollback beyond the grace as tampered", () => {
    const v = evaluateSession(state({ highWater: 5_000 }), 5_000 - CLOCK_GRACE_MS - 1);
    expect(v.status).toBe("tampered");
  });

  it("tolerates a small rollback within the grace (NTP)", () => {
    const v = evaluateSession(state({ highWater: 5_000 }), 5_000 - CLOCK_GRACE_MS + 1);
    expect(v.status).toBe("active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @karate/local exec vitest run src/session-guard.test.ts`
Expected: FAIL — cannot resolve `./session-guard`.

- [ ] **Step 3: Write the implementation**

Create `apps/local/src/session-guard.ts`:

```ts
// Offline clock-tamper policy (pure; persistence lives in sealed-session.ts).
// Ported from the interface template's cli/lib/clock-guard.mjs.
//
// Two independent limits, whichever fires first ends the session:
//   - wall clock:       now >= expiresAt
//   - monotonic budget: accumulated runtime >= (expiresAt - issuedAt)
// Plus a high-water mark: if the wall clock reads earlier than the newest time
// we've observed (minus a small grace for NTP), the clock was rolled back.

export type { SealedSessionState } from "./sealed-session";
import type { SealedSessionState } from "./sealed-session";

export const CLOCK_GRACE_MS = 90_000;
export const TICK_MS = 5_000;

/** Default offline grace added to the JWT exp. Mirrors the web app's grace
 *  window (currently 48h post-activation). Keep in sync with apps/web. */
export const DEFAULT_OFFLINE_GRACE_MS = 48 * 60 * 60 * 1000;

export type SessionVerdict =
  | { status: "active"; remainingWallMs: number; remainingBudgetMs: number }
  | { status: "expired" }
  | { status: "budget-exhausted" }
  | { status: "tampered" };

export function evaluateSession(state: SealedSessionState, now: number = Date.now()): SessionVerdict {
  if (now < state.highWater - CLOCK_GRACE_MS) return { status: "tampered" };
  if (now >= state.expiresAt) return { status: "expired" };
  const totalBudgetMs = state.expiresAt - state.issuedAt;
  if (state.budgetUsedMs >= totalBudgetMs) return { status: "budget-exhausted" };
  return {
    status: "active",
    remainingWallMs: state.expiresAt - now,
    remainingBudgetMs: totalBudgetMs - state.budgetUsedMs,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @karate/local exec vitest run src/session-guard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/local/src/session-guard.ts apps/local/src/session-guard.test.ts
git commit -m "feat(local): pure clock-tamper policy (session-guard)"
```

---

### Task 4: `session-manager.ts` — runtime orchestration

Owns the sealed state, the 5s tick (monotonic budget accrual + high-water advance), the lock latch, and the enforcement callback. Clocks are injectable for testing.

**Files:**
- Create: `apps/local/src/session-manager.ts`
- Test: `apps/local/src/session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/local/src/session-manager.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @karate/local exec vitest run src/session-manager.test.ts`
Expected: FAIL — cannot resolve `./session-manager`.

- [ ] **Step 3: Write the implementation**

Create `apps/local/src/session-manager.ts`:

```ts
import { evaluateSession, TICK_MS, type SessionVerdict } from "./session-guard";
import {
  loadInstallKey,
  readState,
  writeState,
  deleteState,
  type SealedSessionState,
} from "./sealed-session";

/** Reason surfaced to the web UI. Matches core's LicenseDegradedReason values. */
export type LockReason = "CLOCK_TAMPER" | "EXPIRED";

export interface ObservedLicense {
  sub: string;
  issuedAt: number;  // ms (JWT iat)
  expiresAt: number; // ms (JWT exp + offline grace)
}

export interface SessionManager {
  start(): void;
  stop(): void;
  /** Establish/resume tracking for a freshly verified license window. */
  observe(license: ObservedLicense): void;
  /** True unless a tracked session has been locked by the guard. */
  isActive(): boolean;
  /** Current lock reason, or null while active/untracked. */
  peek(): LockReason | null;
  /** Clear all tracking (logout / reset). */
  clear(): void;
  /** Run one evaluation immediately (used by the tick and by tests). */
  tickNow(): void;
  /** Test/introspection helper. */
  debugState(): SealedSessionState | null;
}

export interface SessionManagerOptions {
  dataDir: string;
  onEnforced: (reason: LockReason) => void;
  now?: () => number;
  monotonicMs?: () => number;
}

function verdictToReason(v: Exclude<SessionVerdict, { status: "active" }>): LockReason {
  return v.status === "tampered" ? "CLOCK_TAMPER" : "EXPIRED"; // expired | budget-exhausted → EXPIRED
}

export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  const now = opts.now ?? (() => Date.now());
  const monotonicMs = opts.monotonicMs ?? (() => Number(process.hrtime.bigint() / 1_000_000n));

  const keyHex = loadInstallKey(opts.dataDir);
  let state: SealedSessionState | null = null;
  let locked: LockReason | null = null;
  let lastMono = 0;
  let timer: NodeJS.Timeout | null = null;

  function persist(): void {
    if (state) writeState(opts.dataDir, keyHex, state);
  }

  function enforce(reason: LockReason): void {
    locked = reason;
    deleteState(opts.dataDir); // drop the (possibly forged) file; keep in-memory state for recovery comparison
    opts.onEnforced(reason);
  }

  function tickNow(): void {
    if (!state || locked) return;
    const wall = now();
    const mono = monotonicMs();
    const delta = Math.max(0, mono - lastMono);
    lastMono = mono;
    if (wall > state.highWater) state.highWater = wall;
    state.budgetUsedMs += delta;
    const verdict = evaluateSession(state, wall);
    if (verdict.status !== "active") {
      enforce(verdictToReason(verdict));
      return;
    }
    persist();
  }

  function observe(license: ObservedLicense): void {
    if (locked) {
      const renewed = state != null && state.sub === license.sub && license.expiresAt > state.expiresAt;
      const newIdentity = state == null || state.sub !== license.sub;
      if (!renewed && !newIdentity) return; // same locked token → stay locked
      locked = null;
    }
    if (state && state.sub === license.sub) {
      if (license.expiresAt > state.expiresAt) {
        state.expiresAt = license.expiresAt;
        persist();
      }
      return;
    }
    state = {
      sub: license.sub,
      issuedAt: license.issuedAt,
      expiresAt: license.expiresAt,
      highWater: now(),
      budgetUsedMs: 0,
    };
    lastMono = monotonicMs();
    persist();
  }

  function isActive(): boolean {
    if (locked) return false;
    if (!state) return true; // nothing to protect yet → don't block (JWT layer still guards)
    const verdict = evaluateSession(state, now());
    if (verdict.status !== "active") {
      // Enforce lazily so a wall-clock expiry between ticks is caught immediately.
      enforce(verdictToReason(verdict));
      return false;
    }
    return true;
  }

  return {
    start() {
      state = readState(opts.dataDir, keyHex); // resume; null if missing or tampered
      lastMono = monotonicMs();
      if (state) tickNow(); // catch a session that went invalid while we were down
      timer = setInterval(tickNow, TICK_MS);
      if (typeof timer.unref === "function") timer.unref();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    observe,
    isActive,
    peek: () => locked,
    clear() {
      state = null;
      locked = null;
      deleteState(opts.dataDir);
    },
    tickNow,
    debugState: () => (state ? { ...state } : null),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @karate/local exec vitest run src/session-manager.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/local/src/session-manager.ts apps/local/src/session-manager.test.ts
git commit -m "feat(local): session-manager runtime (tick, budget, lock latch)"
```

---

### Task 5: Force-drop LAN clients with a reason on lock (realtime harvest)

The template ends a session by messaging every client *then* closing (`interface/cli/lib/realtime.mjs:81`). Today `disconnectAll()` (`apps/local/src/network/ws-server.ts:381`) closes sockets silently. Add a reason so already-approved referees flip to a locked screen instead of silently reconnecting.

**Files:**
- Modify: `apps/local/src/network/ws-server.ts:381-388`
- Modify: `apps/local/src/network/controller.ts:24` (interface), `:125` (delegate)

- [ ] **Step 1: Update `disconnectAll` in the WS server**

In `apps/local/src/network/ws-server.ts`, replace the `disconnectAll` function (currently lines 381-388) with:

```ts
  function disconnectAll(reason = "host_unlicensed") {
    for (const [ws, meta] of clients) {
      if (meta.pendingTimeout) { clearTimeout(meta.pendingTimeout); meta.pendingTimeout = null; }
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: MSG.CONNECTION_REJECTED, reason })); } catch {}
      }
      try { ws.close(); } catch {}
    }
    approvedClientIds.clear();
    notifyPending();
  }
```

Also update the interface type at `apps/local/src/network/ws-server.ts:51`:

```ts
  disconnectAll(reason?: string): void;
```

- [ ] **Step 2: Thread the reason through the controller**

In `apps/local/src/network/controller.ts`, update the interface member (line 24):

```ts
  disconnectAll(reason?: string): void;
```

and the delegate (line 125):

```ts
    disconnectAll: (reason?: string) => server.disconnectAll(reason),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @karate/local typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/local/src/network/ws-server.ts apps/local/src/network/controller.ts
git commit -m "feat(local): notify LAN clients with reason on force-drop"
```

---

### Task 6: Wire the manager into the server (enforcement + lock reason + status endpoint)

Create the manager in `createServer`, feed `isActive()` into `isHostLicensed`, drop clients on enforcement, expose the lock reason, and record the window on activation.

**Files:**
- Modify: `apps/local/src/index.ts:100-116, 137-160`
- Modify: `apps/local/src/routes.ts:36-46` (accept an `onLicenseObserved` hook), and the two `/api/activate` success paths (~145 cloud, ~245 local)
- Modify: `apps/local/src/network/routes.ts` (add `GET /api/session/status`) — see Step 4

- [ ] **Step 1: Create and start the manager in `createServer`**

In `apps/local/src/index.ts`, add the import near the other local imports (after line 15):

```ts
import { createSessionManager, type LockReason } from "./session-manager";
import { DEFAULT_OFFLINE_GRACE_MS } from "./session-guard";
```

Then, immediately BEFORE `const httpServer = http.createServer(app);` (currently line 106), insert:

```ts
  // Offline anti-tamper guard. Records the host license window at activation
  // and enforces it every 5s against the monotonic clock + a sealed high-water
  // mark. On a failing verdict it force-drops every LAN client and latches a
  // lock reason the web UI reads via GET /api/session/status.
  let hostLockReason: LockReason | null = null;
  const sessionManager = createSessionManager({
    dataDir: config.dataDir,
    onEnforced: (reason) => {
      hostLockReason = reason;
      // network is defined just below; guarded because onEnforced can fire on start().
      try { network.disconnectAll(reason === "CLOCK_TAMPER" ? "clock_tamper" : "expired"); } catch {}
    },
  });

  const observeLicense = (sub: string, iatSeconds: number, expSeconds: number) => {
    hostLockReason = null;
    sessionManager.observe({
      sub,
      issuedAt: iatSeconds * 1000,
      expiresAt: expSeconds * 1000 + DEFAULT_OFFLINE_GRACE_MS,
    });
  };
```

Update the `buildRoutes` call (currently line 104) to pass the observe hook — change it to:

```ts
  app.use(buildRoutes(config, keys, licenses, kioskSession, getLocalAdminToken, observeLicense));
```

Update the controller creation (currently lines 107-111) to consult the guard:

```ts
  const network = createNetworkController({
    httpServer,
    dataDir: config.dataDir,
    isHostLicensed: () => sessionManager.isActive(),
  });
```

Note the forward-reference: `onEnforced` references `network`, which is assigned right after `sessionManager`. Because `onEnforced` is only invoked from `sessionManager.start()` (called later) or the tick, `network` is always defined by then; the `try/catch` covers the theoretical boot-time enforce. Start the manager inside the returned `start()` (see Step 2).

- [ ] **Step 2: Start/stop the manager with the server, and expose the reason**

In `apps/local/src/index.ts`, in the returned object's `start()` (currently lines 146-155), add `sessionManager.start();` right after `network.start();`:

```ts
    start() {
      return new Promise((resolve) => {
        httpServer.listen(config.port, "0.0.0.0", () => {
          network.start();
          sessionManager.start();
          const addr = httpServer.address();
          const port = typeof addr === "object" && addr ? addr.port : config.port;
          resolve({ port, url: `http://0.0.0.0:${port}` });
        });
      });
    },
```

In `stop()` (currently lines 156-159), stop it:

```ts
    async stop() {
      sessionManager.stop();
      await network.stop();
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
```

Add a getter to the returned object so the status route can read the reason — add this member inside the returned object (e.g. after `network,` on line 145):

```ts
    getHostLockReason: () => hostLockReason,
```

And add it to the `KarateServer` interface (after `network: NetworkController;`, line 26):

```ts
  getHostLockReason(): LockReason | null;
```

Add the import of the type at the top is already covered by Step 1's `import { ..., type LockReason }`.

- [ ] **Step 3: Record the license window on activation**

In `apps/local/src/routes.ts`, extend `buildRoutes`'s signature (lines 36-42) to accept the hook:

```ts
export function buildRoutes(
  config: ServerConfig,
  keys: KeyPair,
  licenses: LicenseStore,
  kioskSession?: KioskSession | null,
  getLocalAdminToken: () => string | null = () => null,
  onLicenseObserved: (sub: string, iatSeconds: number, expSeconds: number) => void = () => {},
): Router {
```

In the **cloud-proxy** success branch (inside the `if (upstream.ok)` block, right after the existing `logActivity(...)` call near line 153), add:

```ts
            try {
              const parsed2 = JSON.parse(text) as { payload?: { sub?: string; iat?: number; exp?: number } };
              if (parsed2.payload?.sub && parsed2.payload.iat && parsed2.payload.exp) {
                onLicenseObserved(parsed2.payload.sub, parsed2.payload.iat, parsed2.payload.exp);
              }
            } catch { /* response wasn't JSON; guard simply isn't recorded */ }
```

In the **local-mode** branch, after the token is signed (the `const { token, payload } = await signLicenseToken(...)` around line 247), add immediately after that call:

```ts
      onLicenseObserved(payload.sub, payload.iat, payload.exp);
```

- [ ] **Step 4: Add the status endpoint**

The status route needs the lock reason. The simplest wiring: register a tiny route directly in `index.ts` (it has `hostLockReason` in scope) rather than plumbing through `buildNetworkRoutes`. Add this right after the `buildNetworkRoutes` mount (currently lines 112-116) in `apps/local/src/index.ts`:

```ts
  app.get("/api/session/status", (_req, res) => {
    res.json({ locked: hostLockReason }); // null when active
  });
```

- [ ] **Step 5: Typecheck and run the whole local test suite**

Run: `pnpm --filter @karate/local typecheck`
Expected: PASS.

Run: `pnpm --filter @karate/local test`
Expected: PASS (sealed-session + session-guard + session-manager suites).

- [ ] **Step 6: Commit**

```bash
git add apps/local/src/index.ts apps/local/src/routes.ts
git commit -m "feat(local): enforce offline anti-tamper guard + /api/session/status"
```

---

### Task 7: Web — lock the UI when the server reports a tampered/expired session

`apps/web/lib/auth-context.tsx` already has a 30s interval that sets `{ kind: "degraded", reason }` (used today for cloud revoke, e.g. line 408). Extend that same interval to poll the local server's lock status and degrade on it. `CLOCK_TAMPER` and `EXPIRED` are already valid `LicenseDegradedReason` values (`packages/core/src/auth-types.ts:41-47`), so no core change is needed.

**Files:**
- Modify: `apps/web/lib/auth-context.tsx` (inside the existing `check` interval, around lines 385-415)

- [ ] **Step 1: Add the host-lock poll to the existing interval**

In `apps/web/lib/auth-context.tsx`, inside the `check` function that runs on the 30s `setInterval` (the same function that does the cloud revoke probe near line 385), add the following BEFORE the `// Cloud revoke probe.` block:

```ts
      // Host anti-tamper lock: the local server enforces the offline window
      // (clock rollback / freeze) and reports it here. Same-origin fetch.
      if (!guestSession && (licenseState.kind === "active" || licenseState.kind === "grace")) {
        try {
          const r = await fetch("/api/session/status", { cache: "no-store" });
          if (r.ok) {
            const { locked } = (await r.json()) as { locked: "CLOCK_TAMPER" | "EXPIRED" | null };
            if (locked) {
              const lastRole =
                licenseState.kind === "active" || licenseState.kind === "grace"
                  ? licenseState.license.role
                  : null;
              const license = typeof window !== "undefined" ? window.__KARATE__?.license : null;
              if (license) await license.reset().catch(() => null);
              clearSessionToken();
              setToken(null);
              setLicenseState({ kind: "degraded", reason: locked, lastRole });
              return;
            }
          }
        } catch {
          // No local server / network hiccup → ignore; JWT exp is the ceiling.
        }
      }
```

(This reuses the same helpers the cloud-revoke branch already uses: `clearSessionToken`, `setToken`, `setLicenseState`, `window.__KARATE__?.license`. Confirm they are in scope in this effect — they are, since the revoke branch below uses them.)

- [ ] **Step 2: Build the web app**

Run: `pnpm --filter @karate/web build`
Expected: PASS (static export builds clean).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/auth-context.tsx
git commit -m "feat(web): lock UI on server-reported clock-tamper/expiry"
```

---

### Task 8: Full-repo verification

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: PASS for `@karate/core`, `@karate/local`, `@karate/web`, `@karate/cloud`.

- [ ] **Step 2: Run all unit tests**

Run: `pnpm --filter @karate/core test && pnpm --filter @karate/local test`
Expected: PASS (core engine suite + the three new local suites).

- [ ] **Step 3: Build everything**

Run: `pnpm build`
Expected: PASS (turbo builds all packages).

- [ ] **Step 4: Manual end-to-end smoke (local dev mode)**

These mirror `interface/docs/E2E-CHECKLIST.md` adapted to Kumite/OS. Run with `KARATE_CLOUD_URL="" pnpm --filter @karate/local dev` (local signing mode) and a seeded 6-digit code.

- [ ] Activate on the host → `dataDir/keys/session.json` and `dataDir/keys/install-key` (mode 600) appear.
- [ ] Connect a LAN referee (or a second loopback client approved) so it is `approved`.
- [ ] **Rollback:** set the system clock back >90s → within ~5s the host logs an enforcement, the referee receives `CONNECTION_REJECTED reason: clock_tamper` and drops, and the host UI (or `curl localhost:4747/api/session/status`) shows `{"locked":"CLOCK_TAMPER"}`.
- [ ] **Freeze (budget):** re-activate, then use a short-window code (or temporarily lower the window) and freeze the wall clock → access ends when accumulated runtime reaches the window even though the wall clock still shows time left → `{"locked":"EXPIRED"}`.
- [ ] **Hand-edit:** change any byte of `session.json` → next tick deletes it and locks.
- [ ] **Clean restart:** with valid state, stop and restart the server → session resumes, `budgetUsedMs` keeps climbing (does not reset), UI stays unlocked.

- [ ] **Step 5: Regression check**

- [ ] Normal online activation still works; the 30s cloud JTI revoke probe still locks on server-side revoke.
- [ ] Guest approval flow (approve/deny, 60s pending timeout) unchanged.
- [ ] Scoreboard state sync across `/private` + `/public` unchanged.
- [ ] `kumiteos update`, `kumiteos version`, `kumiteos help` unchanged (not touched by this plan).

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(local): verify offline anti-tamper end-to-end"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** anti-tamper core = Tasks 2-4; server wiring/enforcement = Tasks 5-6; realtime harvest (force-drop with reason) = Task 5; browser lock surface = Task 7; verification = Task 8. Code-admin and self-update are deliberately out of scope per the spec.
- **Type consistency:** `SealedSessionState` is defined in `sealed-session.ts` and re-exported from `session-guard.ts`; `LockReason` (`"CLOCK_TAMPER" | "EXPIRED"`) is produced by the manager and consumed unchanged by both `/api/session/status` and `auth-context.tsx`; both values already exist in core's `LicenseDegradedReason`.
- **Grace value:** `DEFAULT_OFFLINE_GRACE_MS` (48h) mirrors the web grace window. If the web derives grace differently, align this constant during Task 6 — it is the single source of truth for the server-side window.
- **No renewal:** the window is fixed at activation (`/api/renew-token` was removed), so `observe()` only ever creates or (defensively) extends; it never needs to reset budget mid-tournament.
