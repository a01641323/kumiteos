import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./engine-types";
import { ensureEngineState } from "./engine";
import type { AppState } from "./types";
import { buildInitialState } from "./state";

describe("engine test harness", () => {
  it("loads engine defaults", () => {
    expect(DEFAULT_ENGINE_CONFIG.minRestSeconds).toBe(120);
  });
});

describe("config migration", () => {
  it("backfills new config fields onto legacy engine state", () => {
    const state = buildInitialState() as AppState;
    // Simulate legacy persisted engine config missing the new fields.
    (state as any).engine = {
      config: { avgMatchDurationSeconds: 200, minRestSeconds: 90 },
      areas: [], matches: {}, competitors: {}, subcategories: {},
      nextMatchPerArea: {}, assignmentQueue: [], lastTickTs: 0,
    };
    const eng = ensureEngineState(state);
    expect(eng.config.congestionThresholdPct).toBe(0.175);
    expect(eng.config.minQueueDepthForIntervention).toBe(3);
    expect(eng.config.throughputWarmupMatches).toBe(2);
    // Existing legacy values are preserved, not clobbered.
    expect(eng.config.avgMatchDurationSeconds).toBe(200);
    expect(eng.config.minRestSeconds).toBe(90);
  });
});
