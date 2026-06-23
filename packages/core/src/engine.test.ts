import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./engine-types";
import { ensureEngineState } from "./engine";
import type { AppState } from "./types";
import { buildInitialState } from "./state";
import { getRankedNeighbors } from "./areas";

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

describe("getRankedNeighbors", () => {
  it("defaults to a linear chain sorted by distance", () => {
    // 5 areas, from area 2: nearest are 1 & 3, then 0 & 4.
    expect(getRankedNeighbors(2, 5, undefined)).toEqual([1, 3, 0, 4]);
  });
  it("never includes the area itself", () => {
    expect(getRankedNeighbors(0, 3, undefined)).toEqual([1, 2]);
  });
  it("uses an explicit adjacency list when provided, filtering invalid indices", () => {
    const adjacency = [[2, 1], [0], [0, 1], [99]];
    expect(getRankedNeighbors(0, 4, adjacency)).toEqual([2, 1]);
    expect(getRankedNeighbors(3, 4, adjacency)).toEqual([]); // 99 out of range
  });
});
