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
