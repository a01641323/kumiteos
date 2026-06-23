# Match assignment optimization — detect→reroute engine rework

## Context

`packages/core/src/engine.ts` already runs a server-side, idempotent,
event-driven match-assignment engine. It hydrates a runtime view from the
bracket trees, enforces the hard constraints (2-minute rest via `restOk`,
kata-before-kumite via `kataOrderingOk`), detects slow areas, and computes a
`nextMatchPerArea` suggestion by scoring every ready match against every area
each tick.

A new logic specification ("Match Assignment Optimization") describes the same
problem from a different angle: continuously monitor each area's **throughput**,
flag an area as **congested** when it falls below the *global average*, and then
**reroute one waiting match at a time** to the best legal **neighboring** area —
like traffic rerouting — so no area accumulates excessive delay while others
advance freely.

The current engine differs from that spec in three ways:

1. **Assignment philosophy** — it re-scores all ready matches every tick rather
   than running an explicit detect→reroute intervention.
2. **Congestion metric** — it uses an *absolute* `performanceRatio` vs a fixed
   `delayThreshold` (0.85), not a *relative* rate vs the global average.
3. **Relocation granularity** — `redistributeBehindSubcategories` moves a *whole
   subcategory* to the lightest-load area; the spec moves *one match* to the
   highest-throughput *neighbor*, and adds a configurable **venue adjacency**
   layout (the engine today only knows numeric index ±1).

This design reworks the existing engine toward the spec's model. The initial
subcategory→area assignment (`buildAreaPlan` in `areas.ts`) is the spec's
"separate module" and is treated as correct input — unchanged here.

User-confirmed decisions:

- **Relationship**: rework `engine.ts` — one engine, evolved. No second module,
  no duplicated constraint logic.
- **Congestion metric**: relative throughput vs the global average across active
  areas (replaces the absolute `delayThreshold`).
- **Frozen NEXT**: auto-freeze the hint. Once the engine surfaces a next-match
  for an area, it is pinned and rebalancing never touches it; it unpins only
  when the current match completes (or the area is disabled). No new operator
  action.
- **Venue layout**: add an optional `areaAdjacency` config (ranked neighbors per
  area), defaulting to a linear chain (±1). Organizer-facing input UX stays
  deferred.
- **Tests**: introduce Vitest scoped to `packages/core` and unit-test the
  reworked logic.

## Engine pipeline (new shape)

`runEngineTick` keeps its front half (hydrate, drop stale assignments) and
restructures the back half into an explicit, spec-shaped pipeline:

```
hydrate
  → freeze/validate NEXT per area      (keep still-valid pins, clear invalid)
  → fill empty NEXT slots              (scorePair, as today, only for nulls)
  → compute throughput + global avg
  → run congestion interventions       (relocate one waiting match per area)
```

The engine stays idempotent: with no state change between ticks, frozen NEXTs
persist, throughput is unchanged, and no intervention fires twice for the same
imbalance (an override, once written, removes the candidate from the source
area's pending queue).

## 1. Relative-throughput congestion

- `computeThroughput(area, now)` = `area.matchHistory.length / elapsedMinutes`,
  where `elapsedMinutes = (now − firstMatchAssignedTs) / 60000`.
- **Warmup guard**: an area's rate counts only after it has completed
  `throughputWarmupMatches` (default 2) matches. Below that it is neither
  flagged congested nor used as a destination — prevents a just-started area
  from reading as "infinitely slow" and thrashing. (Not in the spec; required
  for a rate-based metric to be stable.)
- Global average = mean throughput across eligible (past-warmup, non-`LIBRE`)
  areas.
- **Congested** ⟺ `throughput < globalAvg × (1 − congestionThresholdPct)`,
  default `congestionThresholdPct = 0.175`.
- `computeAreaStatus` is rewritten: `LIBRE` = no assigned work; `RETRASADA` =
  relatively congested; `ACTIVA` = active and not congested. The enum and its
  UI consumers are unchanged. `performanceRatio` is replaced by a cached
  `throughput` field for diagnostics.

## 2. Auto-frozen NEXT

- `nextMatchPerArea` is no longer wiped each tick. At tick start, each area's
  existing NEXT is **kept** iff its match is still `READY` and still passes
  `restOk` + `kataOrderingOk` and neither competitor is `ABSENT`. Invalidated or
  empty slots are refilled via the existing `scorePair` selection.
- `recordMatchStart` clears the started area's NEXT (the match is now
  `IN_PROGRESS`); the next tick chooses a fresh NEXT.
- **Guarantee**: rebalancing may only touch matches that are neither
  `IN_PROGRESS` nor a frozen NEXT. The spec's "only the PENDING QUEUE is
  mutable" is enforced structurally, not by convention.

## 3. PENDING QUEUE and "waiting longest"

- An area's pending queue = ready/pending matches of the subcategories assigned
  to it (via `areaAssignments`, adjusted by overrides — §6), minus the
  `IN_PROGRESS` match and the frozen NEXT.
- `MatchRuntime` gains `readySince: number | null`, stamped when a match
  transitions into `READY` (preserved across re-hydration like `startTs`).
  Longest-waiting = smallest `readySince`.

## 4. Single-match relocation (`runCongestionInterventions`)

Replaces `redistributeBehindSubcategories`. For each congested area, most
congested first:

1. Skip if its pending-queue depth < `minQueueDepthForIntervention` (default 3)
   — the spec's "don't intervene on a near-empty area."
2. **Candidate** = longest-waiting pending match (smallest `readySince`).
3. **Destination**: walk the area's ranked neighbor list (§5), nearest first;
   take the first neighbor that is *not disabled, not itself congested,* and can
   **legally receive** — both competitors pass `restOk` and `kataOrderingOk`
   against that neighbor's current schedule.
   - **Resolution of spec ambiguity**: the spec names both "highest-throughput
     destination" and "nearest neighbor first." This design treats **proximity
     as the hard preference** and throughput as a qualifier (must be a
     non-congested neighbor). First qualifying neighbor in proximity order wins.
4. **Execute** by writing a per-match override (§6). One match per congested
   area per tick; severe backlogs drain over successive ticks. If no neighbor
   can legally receive, take no action and re-evaluate next tick.

## 5. Venue adjacency config

- `TournamentSettings` gains `areaAdjacency?: number[][]` — for each area index,
  neighbor indices ranked nearest-first.
- Helper `getRankedNeighbors(areaIndex, areaCount, adjacency)` in `areas.ts`.
  Default when `areaAdjacency` is unset = linear chain (neighbors sorted by
  `|i − j|`), matching today's ±1 behavior.
- `scorePair`'s adjacency bonus switches from hardcoded `±1` to this ranked
  list, so the layout informs normal scoring too.

## 6. How a single match moves

- `EngineState` gains `matchAreaOverrides: Record<string, number>` (matchId →
  areaIndex). "Matches belonging to area i" = subcategories assigned to i
  **minus** matches overridden away **plus** matches overridden in. This keeps
  subcategory continuity (the remaining matches stay) while relocating exactly
  one match. The stable `matchId` survives re-hydration, so overrides persist
  and are serialized with engine state.
- An override is dropped automatically once its match is `COMPLETED` or no
  longer exists.

## 7. Area-disable behavior

- **Deviation from literal spec #4** (kept intentionally): the spec says only the
  NEXT match moves on disable. In practice a disabled area's *entire* remaining
  workload must relocate. The existing `SET_AREA_DISABLED` handler already
  re-bin-packs all of the disabled area's subcategories onto survivors via
  `buildAreaPlan` — correct and more complete.
- The rework **keeps** that re-bin-pack and additionally **clears the disabled
  area's frozen NEXT** so the called-up match is re-picked by its new area.
  `IN_PROGRESS` is never touched. Net effect satisfies the spirit of #4.

## 8. Config and migration

`EngineConfig` changes:

- **Remove** `delayThreshold`.
- **Add** `congestionThresholdPct` (0.175), `minQueueDepthForIntervention` (3),
  `throughputWarmupMatches` (2).
- Keep `avgMatchDurationSeconds` (still used for pace estimates) and the
  `score*` weights.
- `ensureEngineState` merges `DEFAULT_ENGINE_CONFIG` into any loaded config so
  state persisted before this change gains the new fields.

Pace fields (`paceDeltaSeconds`, `paceTier`) remain for the UI but no longer
trigger relocation.

## Data-shape summary

| Type | Change |
|------|--------|
| `EngineConfig` | −`delayThreshold`; +`congestionThresholdPct`, `minQueueDepthForIntervention`, `throughputWarmupMatches` |
| `MatchRuntime` | +`readySince: number \| null` |
| `AreaRuntime` | `performanceRatio` → `throughput: number \| null` |
| `EngineState` | +`matchAreaOverrides: Record<string, number>` |
| `TournamentSettings` | +`areaAdjacency?: number[][]` |

## Files touched

- `packages/core/src/engine.ts` — main rework (pipeline, throughput, freeze,
  intervention; remove `redistributeBehindSubcategories`).
- `packages/core/src/engine-types.ts` — config, `readySince`, `throughput`,
  `matchAreaOverrides`.
- `packages/core/src/types.ts` — `TournamentSettings.areaAdjacency`.
- `packages/core/src/areas.ts` — `getRankedNeighbors` helper.
- `apps/local/src/network/actions.ts` — `SET_AREA_DISABLED` clears the disabled
  area's frozen NEXT.
- `packages/core/src/engine.test.ts` (new) + Vitest config + `test` script in
  `packages/core/package.json`.

## Testing / verification

Vitest unit tests in `packages/core` covering:

- Relative congestion detection and the warmup guard.
- Longest-waiting candidate selection by `readySince`.
- Neighbor walk + legal filtering (rest, kata ordering, disabled, congested).
- Override application: candidate leaves source pending queue, appears in
  destination; override cleared on completion.
- Frozen-NEXT persistence across ticks and unfreeze-on-invalidation.
- `minQueueDepthForIntervention` guard (no move when queue is shallow).
- Disable handling (NEXT cleared, IN_PROGRESS untouched, re-bin-pack runs).
- Tick idempotency (no change in → no change out).

End-to-end: build `packages/core` (`tsc`) and the consuming apps clean; run
`apps/local`, simulate uneven areas, and confirm in the admin area/next-match UI
that a long-waiting match relocates to a faster neighbor and that a frozen NEXT
never silently changes.
