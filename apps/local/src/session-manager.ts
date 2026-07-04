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
