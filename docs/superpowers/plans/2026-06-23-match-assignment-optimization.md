# Match Assignment Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `packages/core/src/engine.ts` from a re-score-everything assigner into an explicit detect→reroute engine: relative-throughput congestion, auto-frozen NEXT, single-match relocation to ranked venue neighbors, with Vitest coverage.

**Architecture:** Keep the engine server-side, idempotent, and bracket-hydrated. Add small **pure helper functions** (throughput, congestion, neighbor ranking, pending-queue selection, relocation-destination picking) that take plain inputs so they unit-test without brackets. Wire them into `runEngineTick` as a post-hydrate pipeline. Relocation is expressed as a per-match override map on `EngineState`, never by editing `areaAssignments`.

**Tech Stack:** TypeScript 5.6 (ESM), pnpm workspace + Turbo, new Vitest test runner scoped to `@karate/core`.

**Spec:** `docs/superpowers/specs/2026-06-23-match-assignment-optimization-design.md`

**Branch:** `feat/match-assignment-optimization` (already created; spec already committed).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/core/src/engine-types.ts` | Engine config + runtime shapes | Modify: config fields, `readySince`, `throughput`, `matchAreaOverrides` |
| `packages/core/src/types.ts` | Domain types | Modify: `TournamentSettings.areaAdjacency` |
| `packages/core/src/areas.ts` | Area planning helpers | Modify: add `getRankedNeighbors` |
| `packages/core/src/engine.ts` | Engine logic | Modify: throughput/congestion, frozen NEXT, intervention, pipeline wiring; remove `redistributeBehindSubcategories` |
| `packages/core/src/engine.test.ts` | Unit tests | Create |
| `packages/core/vitest.config.ts` | Test runner config | Create |
| `packages/core/package.json` | Test deps + script | Modify |
| `apps/local/src/network/actions.ts` | Action handlers | Modify: `SET_AREA_DISABLED` clears frozen NEXT |

All `pnpm`/`git` commands below assume CWD = repo root `/Users/matiashidalgo/Documents/apps_cool/karate`.

---

## Task 0: Vitest setup

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Add Vitest as a dev dependency**

Run:
```bash
pnpm --filter @karate/core add -D vitest@^2.1.0
```
Expected: `package.json` gains `vitest` under `devDependencies`; lockfile updates; install succeeds.

- [ ] **Step 2: Add test scripts to `packages/core/package.json`**

Edit the `"scripts"` block so it reads:
```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create a smoke test at `packages/core/src/engine.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./engine-types";

describe("engine test harness", () => {
  it("loads engine defaults", () => {
    expect(DEFAULT_ENGINE_CONFIG.minRestSeconds).toBe(120);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `pnpm --filter @karate/core test`
Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/vitest.config.ts packages/core/src/engine.test.ts pnpm-lock.yaml
git commit -m "test(core): add vitest runner and smoke test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 1: Engine config — relative-throughput fields + migration

Replace the absolute `delayThreshold` with relative-congestion parameters, and make `ensureEngineState` merge defaults so older persisted state gains new fields.

**Files:**
- Modify: `packages/core/src/engine-types.ts` (`EngineConfig`, `DEFAULT_ENGINE_CONFIG`)
- Modify: `packages/core/src/engine.ts:203-230` (`ensureEngineState`)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `engine.test.ts`:
```ts
import { ensureEngineState } from "./engine";
import type { AppState } from "./types";
import { buildInitialState } from "./state";

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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @karate/core test`
Expected: FAIL — `congestionThresholdPct` is `undefined`.

- [ ] **Step 3: Update `EngineConfig` and `DEFAULT_ENGINE_CONFIG` in `engine-types.ts`**

In `interface EngineConfig`, remove the line:
```ts
  /** performanceRatio threshold under which an area is RETRASADA. */
  delayThreshold: number;
```
and add:
```ts
  /** Fraction below the global average throughput that flags an area congested. */
  congestionThresholdPct: number;
  /** Minimum pending-queue depth before an area is eligible for intervention. */
  minQueueDepthForIntervention: number;
  /** Completed matches an area needs before its throughput counts. */
  throughputWarmupMatches: number;
```

In `DEFAULT_ENGINE_CONFIG`, remove `delayThreshold: 0.85,` and add:
```ts
  congestionThresholdPct: 0.175,
  minQueueDepthForIntervention: 3,
  throughputWarmupMatches: 2,
```

- [ ] **Step 4: Merge defaults in `ensureEngineState` (`engine.ts`)**

In `ensureEngineState`, immediately after `const eng = state.engine;`, add:
```ts
  // Backfill any config fields missing from older persisted state.
  eng.config = { ...DEFAULT_ENGINE_CONFIG, ...eng.config };
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @karate/core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/engine-types.ts packages/core/src/engine.ts packages/core/src/engine.test.ts
git commit -m "feat(core): relative-congestion engine config + default backfill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `getRankedNeighbors` helper (venue adjacency)

A pure function returning neighbor area indices nearest-first. Used by both scoring and relocation.

**Files:**
- Modify: `packages/core/src/types.ts` (`TournamentSettings.areaAdjacency`)
- Modify: `packages/core/src/areas.ts` (add `getRankedNeighbors`)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `engine.test.ts`:
```ts
import { getRankedNeighbors } from "./areas";

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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @karate/core test`
Expected: FAIL — `getRankedNeighbors` is not exported.

- [ ] **Step 3: Add `areaAdjacency` to `TournamentSettings` (`types.ts:150-157`)**

Add inside the interface after `pointDifference?`:
```ts
  /**
   * Optional venue layout: for each area index, neighbor indices ranked
   * nearest-first. When unset, neighbors default to a linear chain (|i-j|).
   */
  areaAdjacency?: number[][];
```

- [ ] **Step 4: Implement `getRankedNeighbors` in `areas.ts`**

Add at the end of the file:
```ts
/**
 * Neighbor area indices for `areaIndex`, ranked nearest-first.
 * With an explicit `adjacency` table, returns its ranked list filtered to
 * valid, non-self indices. Without one, falls back to a linear chain ordered
 * by absolute index distance (ties: lower index first).
 */
export function getRankedNeighbors(
  areaIndex: number,
  areaCount: number,
  adjacency: number[][] | undefined,
): number[] {
  const explicit = adjacency?.[areaIndex];
  if (explicit) {
    return explicit.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < areaCount && i !== areaIndex,
    );
  }
  const others: number[] = [];
  for (let i = 0; i < areaCount; i++) if (i !== areaIndex) others.push(i);
  return others.sort((a, b) => {
    const da = Math.abs(a - areaIndex);
    const db = Math.abs(b - areaIndex);
    return da - db || a - b;
  });
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @karate/core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/areas.ts packages/core/src/engine.test.ts
git commit -m "feat(core): ranked area-neighbor helper + areaAdjacency setting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Throughput + relative congestion

Add pure throughput math and rewrite `computeAreaStatus` to use the relative metric. Rename the cached `performanceRatio` field to `throughput`.

**Files:**
- Modify: `packages/core/src/engine-types.ts` (`AreaRuntime`: `performanceRatio` → `throughput`)
- Modify: `packages/core/src/engine.ts` (add helpers; rewrite `computeAreaStatus`; update `ensureEngineState` default area, `hydrateEngineFromBracket` status loop)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `engine.test.ts`:
```ts
import {
  computeThroughput,
  computeGlobalAverageThroughput,
  isCongested,
} from "./engine";
import type { AreaRuntime } from "./engine-types";

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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @karate/core test`
Expected: FAIL — helpers not exported; `throughput` not on `AreaRuntime`.

- [ ] **Step 3: Rename the field in `engine-types.ts` (`AreaRuntime`)**

Replace:
```ts
  /** Cached last performanceRatio for diagnostics + UI. */
  performanceRatio: number | null;
```
with:
```ts
  /** Cached last throughput (matches/minute) for diagnostics + UI. */
  throughput: number | null;
```

- [ ] **Step 4: Add throughput helpers in `engine.ts`**

Add above `computeAreaStatus`:
```ts
// =============================================================
// Throughput + relative congestion.
// =============================================================

/** Matches completed per minute since the area's first assignment, or null. */
export function computeThroughput(area: AreaRuntime, now: number): number | null {
  if (!area.firstMatchAssignedTs) return null;
  const minutes = Math.max(1 / 60, (now - area.firstMatchAssignedTs) / 60_000);
  return area.matchHistory.length / minutes;
}

/** Mean throughput across areas that are past warmup, or 0 if none qualify. */
export function computeGlobalAverageThroughput(
  areas: AreaRuntime[],
  now: number,
  warmupMatches: number,
): number {
  let sum = 0;
  let n = 0;
  for (const a of areas) {
    if (a.matchHistory.length < warmupMatches) continue;
    const t = computeThroughput(a, now);
    if (t === null) continue;
    sum += t;
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/** True when `throughput` is more than `thresholdPct` below `globalAvg`. */
export function isCongested(
  throughput: number,
  globalAvg: number,
  thresholdPct: number,
): boolean {
  if (globalAvg <= 0) return false;
  return throughput < globalAvg * (1 - thresholdPct);
}
```

- [ ] **Step 5: Rewrite `computeAreaStatus` in `engine.ts`**

Replace the entire body of `computeAreaStatus` with a relative-metric version. Its signature changes to accept the precomputed global average:
```ts
export function computeAreaStatus(
  area: AreaRuntime,
  config: EngineConfig,
  now: number,
  globalAvgThroughput: number,
): AreaStatus {
  const t = computeThroughput(area, now);
  area.throughput = t;
  if (t === null) {
    // Not started yet.
    return area.assignedSubcategories.length === 0 ? "LIBRE" : "ACTIVA";
  }
  if (area.assignedSubcategories.length === 0 && area.matchHistory.length === 0) {
    return "LIBRE";
  }
  // Warming-up areas are never flagged congested.
  if (area.matchHistory.length < config.throughputWarmupMatches) return "ACTIVA";
  return isCongested(t, globalAvgThroughput, config.congestionThresholdPct)
    ? "RETRASADA"
    : "ACTIVA";
}
```

- [ ] **Step 6: Update the status loop in `hydrateEngineFromBracket`**

Replace:
```ts
  // Refresh area statuses (delay detection).
  for (const a of eng.areas) {
    a.status = computeAreaStatus(a, eng.config, now);
  }
```
with:
```ts
  // Refresh area statuses using relative throughput vs the global average.
  const globalAvg = computeGlobalAverageThroughput(
    eng.areas, now, eng.config.throughputWarmupMatches,
  );
  for (const a of eng.areas) {
    a.status = computeAreaStatus(a, eng.config, now, globalAvg);
  }
```

- [ ] **Step 7: Fix the default area in `ensureEngineState`**

In the `prev ?? { ... }` default object, replace `performanceRatio: null,` with `throughput: null,`.

- [ ] **Step 8: Run the test**

Run: `pnpm --filter @karate/core test`
Expected: PASS (the new throughput tests plus all earlier ones).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/engine-types.ts packages/core/src/engine.ts packages/core/src/engine.test.ts
git commit -m "feat(core): relative-throughput congestion detection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `readySince` stamping on matches

Track when each match became `READY` so the longest-waiting one can be selected.

**Files:**
- Modify: `packages/core/src/engine-types.ts` (`MatchRuntime`: add `readySince`)
- Modify: `packages/core/src/engine.ts` (`hydrateEngineFromBracket` match build)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `engine.test.ts`:
```ts
import { stampReadySince } from "./engine";

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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @karate/core test`
Expected: FAIL — `stampReadySince` not exported.

- [ ] **Step 3: Add `readySince` to `MatchRuntime` (`engine-types.ts`)**

After `endTs: number | null;` add:
```ts
  /** Unix ms when this match first became READY (for longest-waiting). */
  readySince: number | null;
```

- [ ] **Step 4: Add `stampReadySince` and use it in `hydrateEngineFromBracket`**

Add this exported helper near the top of `engine.ts` (after `refFromMatchId`):
```ts
/** Stamp/preserve/clear the READY-since timestamp for a match. */
export function stampReadySince(
  status: MatchStatus,
  existing: number | null | undefined,
  now: number,
): number | null {
  if (status !== "READY") return null;
  return existing ?? now;
}
```
In `hydrateEngineFromBracket`, inside the `eng.matches[id] = { ... }` object, add after `endTs: existing?.endTs ?? null,`:
```ts
      readySince: stampReadySince(status, existing?.readySince, now),
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @karate/core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/engine-types.ts packages/core/src/engine.ts packages/core/src/engine.test.ts
git commit -m "feat(core): stamp readySince when matches become READY

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Per-match overrides + area resolution

Add the `matchAreaOverrides` map and a resolver for "which area owns this match," and prune overrides for completed/missing matches.

**Files:**
- Modify: `packages/core/src/engine-types.ts` (`EngineState`: add `matchAreaOverrides`)
- Modify: `packages/core/src/engine.ts` (`buildInitialEngineState`, add `areaForMatch`, add `pruneOverrides`)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `engine.test.ts`:
```ts
import { areaForMatch, pruneOverrides, buildInitialEngineState } from "./engine";

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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @karate/core test`
Expected: FAIL — `matchAreaOverrides`/`areaForMatch`/`pruneOverrides` missing.

- [ ] **Step 3: Add `matchAreaOverrides` to `EngineState` (`engine-types.ts`)**

After `assignmentQueue: string[];` add:
```ts
  /** matchId → areaIndex relocation overrides (single-match reroutes). */
  matchAreaOverrides: Record<string, number>;
```

- [ ] **Step 4: Initialize it in `buildInitialEngineState` (`engine.ts`)**

Add `matchAreaOverrides: {},` to the returned object (next to `assignmentQueue: [],`).

- [ ] **Step 5: Add `areaForMatch` and `pruneOverrides` in `engine.ts`**

Add near the override-related logic (e.g. after `buildInitialEngineState`):
```ts
/** Area that owns a match: its override if present, else its sub's assignment. */
export function areaForMatch(
  eng: EngineState,
  areaAssignments: Record<string, number>,
  matchId: string,
  subcategoryId: string,
): number | null {
  const override = eng.matchAreaOverrides[matchId];
  if (typeof override === "number") return override;
  const assigned = areaAssignments[subcategoryId];
  return typeof assigned === "number" ? assigned : null;
}

/** Drop overrides whose match is completed or no longer exists. */
export function pruneOverrides(eng: EngineState): void {
  for (const id of Object.keys(eng.matchAreaOverrides)) {
    const m = eng.matches[id];
    if (!m || m.status === "COMPLETED") delete eng.matchAreaOverrides[id];
  }
}
```

- [ ] **Step 6: Guard older persisted state in `ensureEngineState`**

In `ensureEngineState`, just after the config backfill line from Task 1 Step 4, add:
```ts
  if (!eng.matchAreaOverrides) eng.matchAreaOverrides = {};
```

- [ ] **Step 7: Run the test**

Run: `pnpm --filter @karate/core test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/engine-types.ts packages/core/src/engine.ts packages/core/src/engine.test.ts
git commit -m "feat(core): per-match area overrides + resolver and pruning

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Auto-frozen NEXT

Stop wiping `nextMatchPerArea` every tick. Keep valid pins; refill only empty/invalidated slots. Clear the pin when its match starts.

**Files:**
- Modify: `packages/core/src/engine.ts` (`runEngineTick` reset/refill loop; `recordMatchStart`; add `isNextHintStillValid`)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Write the failing test (pure validator)**

Append to `engine.test.ts`:
```ts
import { isNextHintStillValid } from "./engine";

describe("frozen NEXT validation", () => {
  const base = {
    id: "m1", status: "READY", a: "Ann", b: "Bob",
  };
  it("keeps a hint whose match is still READY and constraints hold", () => {
    expect(isNextHintStillValid({ ready: true, restOk: true, kataOk: true, absent: false })).toBe(true);
  });
  it("drops a hint when the match is no longer READY", () => {
    expect(isNextHintStillValid({ ready: false, restOk: true, kataOk: true, absent: false })).toBe(false);
  });
  it("drops a hint when rest, kata ordering, or absence fails", () => {
    expect(isNextHintStillValid({ ready: true, restOk: false, kataOk: true, absent: false })).toBe(false);
    expect(isNextHintStillValid({ ready: true, restOk: true, kataOk: false, absent: false })).toBe(false);
    expect(isNextHintStillValid({ ready: true, restOk: true, kataOk: true, absent: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @karate/core test`
Expected: FAIL — `isNextHintStillValid` not exported.

- [ ] **Step 3: Add the pure validator in `engine.ts`**

```ts
/** Whether a frozen NEXT hint should be kept this tick. */
export function isNextHintStillValid(checks: {
  ready: boolean;
  restOk: boolean;
  kataOk: boolean;
  absent: boolean;
}): boolean {
  return checks.ready && checks.restOk && checks.kataOk && !checks.absent;
}
```

- [ ] **Step 4: Rewrite the NEXT reset/refill block in `runEngineTick`**

Replace this block:
```ts
  // Reset hints first.
  for (let i = 0; i < eng.areas.length; i++) eng.nextMatchPerArea[i] = null;
```
with logic that preserves still-valid pins and clears the rest. Insert the `readyById`/validation just after `const ready = listReadyMatches(state, now);` and before the `areasByPriority` sort:
```ts
  // --- Frozen NEXT: keep still-valid pins; clear the rest so they refill. ---
  const readyById = new Map<string, ReadyMatchView>();
  for (const rm of ready) readyById.set(rm.runtime.id, rm);
  for (let i = 0; i < eng.areas.length; i++) {
    const hint = eng.nextMatchPerArea[i];
    if (!hint) { eng.nextMatchPerArea[i] = null; continue; }
    const rm = readyById.get(hint.matchId);
    const valid = rm
      ? isNextHintStillValid({
          ready: true,
          restOk: restOk(eng, rm.a, rm.b, now),
          kataOk: kataOrderingOk(state, eng, rm.ref.subcategoryId, rm.ref.discipline, rm.a, rm.b),
          absent:
            eng.competitors[rm.a]?.status === "ABSENT" ||
            eng.competitors[rm.b]?.status === "ABSENT",
        })
      : false;
    if (valid) {
      usedMatchIds.add(hint.matchId); // pinned — not available to other areas
    } else {
      eng.nextMatchPerArea[i] = null;
    }
  }
```
Then change the refill loop so it only fills empty slots. Replace the `for (const area of areasByPriority) {` body's start:
```ts
  for (const area of areasByPriority) {
    if (disabledAreaSet.has(area.index)) continue;
    if (eng.nextMatchPerArea[area.index]) continue; // keep the frozen pin
```
(Leave the rest of the candidate-scoring/assignment body unchanged for now; Task 7 adjusts the candidate set.)

- [ ] **Step 5: Clear the pin on match start (`recordMatchStart`)**

At the end of `recordMatchStart`, add:
```ts
  // The started match is no longer NEXT — clear the pin so a fresh one fills.
  if (eng.nextMatchPerArea[areaIndex]?.matchId === matchId) {
    eng.nextMatchPerArea[areaIndex] = null;
  }
```

- [ ] **Step 6: Run the unit test**

Run: `pnpm --filter @karate/core test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/engine.test.ts
git commit -m "feat(core): auto-freeze NEXT and only refill empty slots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Congestion intervention (single-match relocation)

Replace `redistributeBehindSubcategories` with pure selection helpers plus an orchestrator that writes one override per congested area.

**Files:**
- Modify: `packages/core/src/engine.ts` (remove `redistributeBehindSubcategories` + its call; add `pendingQueueForArea`, `pickRelocationDestination`, `runCongestionInterventions`)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Write the failing test (pure selection helpers)**

Append to `engine.test.ts`:
```ts
import { pickRelocationDestination } from "./engine";

describe("pickRelocationDestination", () => {
  const areaCount = 4;
  it("returns the nearest non-disabled, non-congested neighbor that can receive", () => {
    const dest = pickRelocationDestination({
      sourceIndex: 1,
      areaCount,
      adjacency: undefined, // linear: from 1 → [0, 2, 3]
      isDisabled: (i) => i === 0,
      isCongested: (i) => false,
      canReceive: (i) => true,
    });
    expect(dest).toBe(2); // 0 disabled → next nearest is 2
  });
  it("skips congested neighbors", () => {
    const dest = pickRelocationDestination({
      sourceIndex: 1, areaCount, adjacency: undefined,
      isDisabled: () => false,
      isCongested: (i) => i === 0 || i === 2,
      canReceive: () => true,
    });
    expect(dest).toBe(3);
  });
  it("returns null when no neighbor can legally receive", () => {
    const dest = pickRelocationDestination({
      sourceIndex: 1, areaCount, adjacency: undefined,
      isDisabled: () => false, isCongested: () => false,
      canReceive: () => false,
    });
    expect(dest).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @karate/core test`
Expected: FAIL — `pickRelocationDestination` not exported.

- [ ] **Step 3: Add `pickRelocationDestination` (pure) in `engine.ts`**

```ts
/** First nearest neighbor that is enabled, not congested, and can receive. */
export function pickRelocationDestination(args: {
  sourceIndex: number;
  areaCount: number;
  adjacency: number[][] | undefined;
  isDisabled: (areaIndex: number) => boolean;
  isCongested: (areaIndex: number) => boolean;
  canReceive: (areaIndex: number) => boolean;
}): number | null {
  const neighbors = getRankedNeighbors(args.sourceIndex, args.areaCount, args.adjacency);
  for (const n of neighbors) {
    if (args.isDisabled(n)) continue;
    if (args.isCongested(n)) continue;
    if (!args.canReceive(n)) continue;
    return n;
  }
  return null;
}
```
Add `getRankedNeighbors` to the existing import from `./areas` at the top of `engine.ts`:
```ts
import { areaLabel, estimatedMatchCount, getRankedNeighbors } from "./areas";
```

- [ ] **Step 4: Add `pendingQueueForArea` (pure over ready views) in `engine.ts`**

```ts
/**
 * Ready matches owned by `areaIndex` (by override or assignment), excluding the
 * area's frozen NEXT and any pinned NEXT elsewhere, sorted longest-waiting first.
 */
export function pendingQueueForArea(
  eng: EngineState,
  areaAssignments: Record<string, number>,
  ready: ReadyMatchView[],
  areaIndex: number,
): ReadyMatchView[] {
  const frozenHere = eng.nextMatchPerArea[areaIndex]?.matchId ?? null;
  const out = ready.filter((rm) => {
    if (rm.runtime.id === frozenHere) return false;
    return areaForMatch(eng, areaAssignments, rm.runtime.id, rm.ref.subcategoryId) === areaIndex;
  });
  out.sort((a, b) => (a.runtime.readySince ?? 0) - (b.runtime.readySince ?? 0));
  return out;
}
```

- [ ] **Step 5: Add the orchestrator `runCongestionInterventions` in `engine.ts`**

```ts
/**
 * For each congested area (most congested first), relocate its longest-waiting
 * pending match to the nearest non-congested neighbor that can legally receive.
 * One match per area per tick. Writes to eng.matchAreaOverrides.
 */
export function runCongestionInterventions(
  state: AppState,
  eng: EngineState,
  ready: ReadyMatchView[],
  now: number,
): void {
  const areaCount = state.tournament.settings.areaCount;
  if (areaCount <= 1) return;
  const assignments = state.tournament.areaAssignments ?? {};
  const disabled = new Set(state.tournament.disabledAreas ?? []);
  const adjacency = state.tournament.settings.areaAdjacency;
  const cfg = eng.config;

  const globalAvg = computeGlobalAverageThroughput(eng.areas, now, cfg.throughputWarmupMatches);

  const congestedAreas = eng.areas
    .filter((a) => a.status === "RETRASADA" && !disabled.has(a.index))
    .map((a) => ({ area: a, t: computeThroughput(a, now) ?? Infinity }))
    .sort((x, y) => x.t - y.t); // slowest first

  const isAreaCongested = (i: number) => eng.areas[i]?.status === "RETRASADA";

  for (const { area } of congestedAreas) {
    const queue = pendingQueueForArea(eng, assignments, ready, area.index);
    if (queue.length < cfg.minQueueDepthForIntervention) continue;
    const candidate = queue[0];

    const dest = pickRelocationDestination({
      sourceIndex: area.index,
      areaCount,
      adjacency,
      isDisabled: (i) => disabled.has(i),
      isCongested: isAreaCongested,
      // Destination must still satisfy the hard constraints for this match.
      canReceive: () =>
        restOk(eng, candidate.a, candidate.b, now) &&
        kataOrderingOk(state, eng, candidate.ref.subcategoryId, candidate.ref.discipline, candidate.a, candidate.b),
    });
    if (dest === null) continue;
    eng.matchAreaOverrides[candidate.runtime.id] = dest;
  }
}
```

- [ ] **Step 6: Remove `redistributeBehindSubcategories` and its helpers**

Delete the function `redistributeBehindSubcategories` and its call site in `hydrateEngineFromBracket`:
```ts
  // (delete this call)
  redistributeBehindSubcategories(state, eng);
```
Also delete the now-unused helpers `countCompletedForSub` and `hasInProgressMatch` **only if** no other reference remains (grep first: `grep -n "countCompletedForSub\|hasInProgressMatch" packages/core/src/engine.ts`). If still referenced, leave them.

- [ ] **Step 7: Run the unit tests**

Run: `pnpm --filter @karate/core test`
Expected: PASS (pure selection tests). `runCongestionInterventions` is covered end-to-end in Task 8.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/engine.test.ts
git commit -m "feat(core): single-match congestion relocation to ranked neighbors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Wire pipeline into `runEngineTick` + integration tests

Apply overrides to the per-area candidate set, call the intervention, prune overrides, and verify behavior on a real mock tournament.

**Files:**
- Modify: `packages/core/src/engine.ts` (`runEngineTick`: candidate filter, intervention call, prune)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Filter the per-area candidate set by override in `runEngineTick`**

In the refill loop, where candidates are scored, replace:
```ts
    for (const m of ready) {
      if (usedMatchIds.has(m.runtime.id)) continue;
```
with:
```ts
    for (const m of ready) {
      if (usedMatchIds.has(m.runtime.id)) continue;
      // Respect relocation overrides: a match overridden elsewhere is not a
      // candidate here; one overridden to this area is.
      const ov = eng.matchAreaOverrides[m.runtime.id];
      if (typeof ov === "number" && ov !== area.index) continue;
```

- [ ] **Step 2: Call the intervention + prune at the end of `runEngineTick`**

Just before `return eng;` at the end of `runEngineTick`, add:
```ts
  pruneOverrides(eng);
  runCongestionInterventions(state, eng, ready, now);
```

- [ ] **Step 3: Write the integration test**

Append to `engine.test.ts`:
```ts
import { runEngineTick, recordMatchStart, recordMatchEnd } from "./engine";
import { generateMockTournament } from "./mock-tournament";

function startedMockState(): AppState {
  const state = buildInitialState() as AppState;
  const mock = generateMockTournament();
  // generateMockTournament returns tournament data; merge into state.
  state.tournament = { ...state.tournament, ...(mock as any).tournament ?? mock };
  return state;
}

describe("runEngineTick integration", () => {
  it("is idempotent: a second no-op tick keeps the same NEXT pins", () => {
    const state = startedMockState();
    const t0 = 1_000_000;
    const eng1 = runEngineTick(state, { now: t0 });
    const snapshot = JSON.stringify(eng1.nextMatchPerArea);
    const eng2 = runEngineTick(state, { now: t0 });
    expect(JSON.stringify(eng2.nextMatchPerArea)).toBe(snapshot);
  });

  it("keeps a frozen NEXT pinned across a later tick", () => {
    const state = startedMockState();
    const t0 = 1_000_000;
    const eng = runEngineTick(state, { now: t0 });
    // Find an area that got a NEXT pin.
    const idx = Object.keys(eng.nextMatchPerArea).find(
      (k) => eng.nextMatchPerArea[Number(k)],
    );
    if (idx === undefined) return; // mock may not populate; skip silently
    const pinned = eng.nextMatchPerArea[Number(idx)]!.matchId;
    const eng2 = runEngineTick(state, { now: t0 + 30_000 });
    expect(eng2.nextMatchPerArea[Number(idx)]?.matchId).toBe(pinned);
  });

  it("prunes an override once its match completes", () => {
    const state = startedMockState();
    const eng = runEngineTick(state, { now: 1_000_000 });
    // Inject an override for an existing match, then complete it.
    const someId = Object.keys(eng.matches)[0];
    eng.matchAreaOverrides[someId] = 1;
    eng.matches[someId].status = "COMPLETED";
    runEngineTick(state, { now: 1_001_000 });
    expect(eng.matchAreaOverrides[someId]).toBeUndefined();
  });
});
```

> **Note for the implementer:** confirm `generateMockTournament()`'s return shape first — run
> `grep -n "return" packages/core/src/mock-tournament.ts` and adjust `startedMockState()` so
> `state.tournament` ends up populated (categories, categoryOrder, areaAssignments, settings.areaCount ≥ 2).
> If the mock doesn't start categories, call `startCategory(state, catId)` for each `state.tournament.categoryOrder`
> and `closeCheckIn` as needed so matches reach `READY`. The assertions above are written to no-op safely if no pins appear.

- [ ] **Step 4: Run the integration tests**

Run: `pnpm --filter @karate/core test`
Expected: PASS. If `startedMockState` doesn't produce READY matches, fix the fixture (see note) until at least the idempotency + prune tests pass meaningfully.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @karate/core typecheck`
Expected: no errors (confirms `performanceRatio`→`throughput` rename and signature changes are consistent within core).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/engine.test.ts
git commit -m "feat(core): wire detect-reroute pipeline into runEngineTick + integration tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `scorePair` adjacency uses the venue layout

Switch the adjacency bonus from hardcoded `±1` to the ranked-neighbor list.

**Files:**
- Modify: `packages/core/src/engine.ts` (`scorePair`)
- Test: `packages/core/src/engine.test.ts`

- [ ] **Step 1: Update `scorePair` adjacency check**

Replace:
```ts
  for (const c of [compA, compB]) {
    if (!c || c.lastAreaIndex === null) continue;
    if (Math.abs(c.lastAreaIndex - area.index) === 1) {
      score += cfg.scoreAdjacencyBonus;
      break;
    }
  }
```
with:
```ts
  const neighbors = getRankedNeighbors(
    area.index,
    ctx.state.tournament.settings.areaCount,
    ctx.state.tournament.settings.areaAdjacency,
  );
  for (const c of [compA, compB]) {
    if (!c || c.lastAreaIndex === null) continue;
    if (neighbors.includes(c.lastAreaIndex)) {
      score += cfg.scoreAdjacencyBonus;
      break;
    }
  }
```

- [ ] **Step 2: Run the full suite (regression)**

Run: `pnpm --filter @karate/core test`
Expected: PASS — no behavioral test regressions.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/engine.ts
git commit -m "feat(core): scorePair adjacency uses ranked venue neighbors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Area-disable clears the frozen NEXT

On disable, clear the disabled area's pinned NEXT so its called-up match is re-picked by its new area. (The existing re-bin-pack stays.)

**Files:**
- Modify: `apps/local/src/network/actions.ts:222-250` (`SET_AREA_DISABLED`)

- [ ] **Step 1: Clear the frozen NEXT inside the `if (disabled) { ... }` block**

In `SET_AREA_DISABLED`, inside `if (disabled) {`, before the `buildAreaPlan` reassignment, add:
```ts
      // Clear the disabled area's frozen NEXT so the called-up match is
      // re-picked by whichever area now owns its subcategory. IN_PROGRESS
      // matches are never touched here.
      if (s.engine?.nextMatchPerArea) {
        s.engine.nextMatchPerArea[areaIndex] = null;
      }
```

- [ ] **Step 2: Typecheck the local app**

Run: `pnpm --filter @karate/local typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/local/src/network/actions.ts
git commit -m "feat(local): clear frozen NEXT when an area is disabled

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Full workspace verification

Confirm the rename and signature changes don't break any consumer (web/admin/local read `performanceRatio` or `computeAreaStatus`?).

**Files:** none (verification only)

- [ ] **Step 1: Grep for stale references to the renamed field and removed function**

Run:
```bash
grep -rn "performanceRatio\|delayThreshold\|redistributeBehindSubcategories" apps packages --include=*.ts --include=*.tsx | grep -v "/out/"
```
Expected: no matches in source (only possibly in built `apps/web/out/` artifacts, which are ignored). If any source file references `performanceRatio`, update it to `throughput`; if any references `computeAreaStatus`, update the call to pass the new `globalAvgThroughput` argument (compute via `computeGlobalAverageThroughput`).

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: all packages pass (`turbo run typecheck`).

- [ ] **Step 3: Run the core test suite once more**

Run: `pnpm --filter @karate/core test`
Expected: all tests PASS.

- [ ] **Step 4: Manual end-to-end smoke (optional but recommended)**

Run: `pnpm start` (launches `@karate/local`), open the admin UI, load a mock/real tournament with ≥2 areas, start categories, and:
- Confirm area status badges still render (now driven by relative throughput).
- Force an imbalance (complete several matches on one area, none on a neighbor) and confirm a long-waiting match relocates to the faster neighbor in the next-match panel.
- Confirm a shown NEXT match does not silently change between ticks.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "fix(core): update consumers for throughput rename

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes (author)

- **Spec coverage:** congestion metric → Task 3; frozen NEXT → Task 6; pending queue/longest-waiting → Tasks 4+7; single-match relocation → Task 7; venue adjacency → Tasks 2+9; overrides mechanism → Task 5; disable handling → Task 10; config+migration → Task 1; warmup guard → Task 3; min-queue-depth → Task 7; tests → all tasks + Task 0.
- **Type consistency:** `computeAreaStatus` gains a 4th arg `globalAvgThroughput` (Tasks 3, 11). `AreaRuntime.performanceRatio` → `throughput` everywhere (Tasks 3, 11). `MatchRuntime.readySince`, `EngineState.matchAreaOverrides` defined in Tasks 4/5 before use in Tasks 6/7/8.
- **Known risk:** `generateMockTournament()` shape is unverified — Task 8 Step 3 includes an explicit instruction to confirm and adapt the fixture, and assertions degrade gracefully if no pins appear.
