import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./engine-types";
import { ensureEngineState } from "./engine";
import type { AppState } from "./types";
import { buildInitialState } from "./state";
import { getRankedNeighbors } from "./areas";
import {
  computeThroughput,
  computeGlobalAverageThroughput,
  isCongested,
} from "./engine";
import type { AreaRuntime } from "./engine-types";

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

function area(partial: Partial<AreaRuntime>): AreaRuntime {
  return {
    index: 0, name: "A", status: "ACTIVA", assignedSubcategories: [],
    matchHistory: [], firstMatchAssignedTs: null, throughput: null,
    ...partial,
  };
}

describe("throughput + congestion", () => {
  const NOW = 1_000_000;
  it("computes matches per minute from history length and start time", () => {
    const a = area({
      firstMatchAssignedTs: NOW - 10 * 60_000,
      matchHistory: Array(5).fill({ matchId: "m", startTs: 0, endTs: 0 }),
    });
    expect(computeThroughput(a, NOW)).toBeCloseTo(0.5, 5); // 5 matches / 10 min
  });
  it("returns null before the area has started", () => {
    expect(computeThroughput(area({ firstMatchAssignedTs: null }), NOW)).toBeNull();
  });
  it("averages only past-warmup areas", () => {
    const fast = area({
      index: 0, firstMatchAssignedTs: NOW - 10 * 60_000,
      matchHistory: Array(10).fill({ matchId: "m", startTs: 0, endTs: 0 }),
    });
    const slow = area({
      index: 1, firstMatchAssignedTs: NOW - 10 * 60_000,
      matchHistory: Array(4).fill({ matchId: "m", startTs: 0, endTs: 0 }),
    });
    const warming = area({
      index: 2, firstMatchAssignedTs: NOW - 60_000,
      matchHistory: [{ matchId: "m", startTs: 0, endTs: 0 }], // 1 < warmup(2)
    });
    const avg = computeGlobalAverageThroughput([fast, slow, warming], NOW, 2);
    expect(avg).toBeCloseTo(0.7, 5); // (1.0 + 0.4) / 2, warming excluded
  });
  it("flags an area below the threshold fraction of average", () => {
    // avg 0.7, threshold 0.175 → cutoff 0.5775. slow=0.4 congested, fast=1.0 not.
    expect(isCongested(0.4, 0.7, 0.175)).toBe(true);
    expect(isCongested(1.0, 0.7, 0.175)).toBe(false);
  });
});

import { stampReadySince, areaForMatch, pruneOverrides, buildInitialEngineState } from "./engine";

describe("readySince stamping", () => {
  it("stamps now when a match first becomes READY", () => {
    expect(stampReadySince("READY", null, 500)).toBe(500);
  });
  it("preserves the original stamp while still READY", () => {
    expect(stampReadySince("READY", 500, 900)).toBe(500);
  });
  it("clears the stamp when not READY", () => {
    expect(stampReadySince("IN_PROGRESS", 500, 900)).toBeNull();
    expect(stampReadySince("PENDING", 500, 900)).toBeNull();
  });
});

describe("match area overrides", () => {
  it("returns the override area when set, else the subcategory assignment", () => {
    const eng = buildInitialEngineState();
    eng.matchAreaOverrides = { "m-overridden": 2 };
    const assignments = { "sub-A": 0 };
    expect(areaForMatch(eng, assignments, "m-overridden", "sub-A")).toBe(2);
    expect(areaForMatch(eng, assignments, "m-plain", "sub-A")).toBe(0);
    expect(areaForMatch(eng, assignments, "m-plain", "sub-unknown")).toBeNull();
  });
  it("prunes overrides for completed or missing matches", () => {
    const eng = buildInitialEngineState();
    eng.matchAreaOverrides = { "m-done": 1, "m-live": 2, "m-gone": 3 };
    eng.matches = {
      "m-done": { id: "m-done", status: "COMPLETED" } as any,
      "m-live": { id: "m-live", status: "READY" } as any,
    };
    pruneOverrides(eng);
    expect(eng.matchAreaOverrides).toEqual({ "m-live": 2 });
  });
});
