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
