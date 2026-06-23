// =============================================================
// Match-assignment engine.
//
// The engine is run on the SERVER only. Its job each tick is:
//   1. Hydrate the runtime view from the bracket trees (matches table,
//      competitor table, subcategory table).
//   2. Recompute competitor statuses (RESTING vs AVAILABLE) from
//      `lastMatchEndTs` and `now`.
//   3. Recompute area statuses (delay detection).
//   4. Compute `nextMatchPerArea` by scoring (area, match) pairs and
//      picking the best for each free or about-to-be-free area.
//
// The engine is *idempotent* and *event-driven* — calling `runEngineTick`
// twice with no state changes in between produces the same output. The
// only side-effect outside the engine state object is to set `engine` on
// the AppState; that field is then included in the next STATE broadcast.
// =============================================================

import type {
  AppState,
  ActiveMatchRef,
  Discipline,
  Match,
  MatchPath,
  StandardTree,
  PlayinTree,
  SeriesTree,
  RRTree,
  Subcategory,
  Category,
} from "./types";
import {
  type EngineConfig,
  type EngineState,
  type AreaRuntime,
  type CompetitorRuntime,
  type MatchRuntime,
  type SubcategoryRuntime,
  type NextMatchHint,
  type MatchStatus,
  type AreaStatus,
  type CompetitorStatus,
  DEFAULT_ENGINE_CONFIG,
} from "./engine-types";
import { getSubcategory } from "./state";
import { areaLabel, estimatedMatchCount } from "./areas";

// =============================================================
// Match ID encoding — stable across engine ticks.
// =============================================================

export function matchIdFromRef(ref: ActiveMatchRef): string {
  const { categoryId, subcategoryId, discipline, path } = ref;
  const base = `${categoryId}::${subcategoryId}::${discipline}`;
  switch (path.kind) {
    case "std":
      return `${base}::std::r${path.round}::i${path.idx}`;
    case "playin":
      return `${base}::playin`;
    case "series":
      return `${base}::series::m${path.idx}`;
    case "rr":
      return `${base}::rr::${path.pair}`;
    case "3rd":
      return `${base}::3rd`;
  }
}

export function refFromMatchId(id: string): ActiveMatchRef | null {
  const parts = id.split("::");
  if (parts.length < 4) return null;
  const [categoryId, subcategoryId, discipline, kind, a, b] = parts;
  if (discipline !== "combat" && discipline !== "kata") return null;
  const d = discipline as Discipline;
  let path: MatchPath | null = null;
  if (kind === "std" && a && b) {
    const round = parseInt(a.slice(1), 10);
    const idx = parseInt(b.slice(1), 10);
    if (Number.isFinite(round) && Number.isFinite(idx)) path = { kind: "std", round, idx };
  } else if (kind === "playin") {
    path = { kind: "playin" };
  } else if (kind === "series" && a) {
    const idx = parseInt(a.slice(1), 10);
    if (Number.isFinite(idx)) path = { kind: "series", idx };
  } else if (kind === "rr" && a) {
    if (a === "ab" || a === "ac" || a === "bc") path = { kind: "rr", pair: a };
  } else if (kind === "3rd") {
    path = { kind: "3rd" };
  }
  if (!path) return null;
  return { categoryId, subcategoryId, discipline: d, path };
}

// =============================================================
// Bracket walking — emit every (ref, match) pair in a subcategory.
// =============================================================

function* iterateSubcategoryMatches(
  catId: string,
  sub: Subcategory
): IterableIterator<{ ref: ActiveMatchRef; match: Match; tree: "KATA" | "COMBAT" }> {
  const disciplines: Discipline[] = Object.keys(sub.trees) as Discipline[];
  for (const d of disciplines) {
    const tree = sub.trees[d];
    if (!tree) continue;
    const treeTag: "KATA" | "COMBAT" = d === "kata" ? "KATA" : "COMBAT";

    if (sub.type === "standard") {
      const t = tree as StandardTree;
      for (let r = 0; r < t.rounds.length; r++) {
        const round = t.rounds[r];
        for (let i = 0; i < round.length; i++) {
          yield {
            ref: { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "std", round: r, idx: i } },
            match: round[i],
            tree: treeTag,
          };
        }
      }
      if (t.thirdPlace) {
        yield {
          ref: { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "3rd" } },
          match: t.thirdPlace,
          tree: treeTag,
        };
      }
    } else if (sub.type === "playin") {
      const t = tree as PlayinTree;
      yield {
        ref: { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "playin" } },
        match: t.extra,
        tree: treeTag,
      };
      for (let r = 0; r < t.bracket.rounds.length; r++) {
        const round = t.bracket.rounds[r];
        for (let i = 0; i < round.length; i++) {
          yield {
            ref: { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "std", round: r, idx: i } },
            match: round[i],
            tree: treeTag,
          };
        }
      }
    } else if (sub.type === "series") {
      const t = tree as SeriesTree;
      for (let i = 0; i < t.matches.length; i++) {
        yield {
          ref: { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "series", idx: i } },
          match: t.matches[i],
          tree: treeTag,
        };
      }
    } else if (sub.type === "roundrobin") {
      const t = tree as RRTree;
      for (const m of t.matches) {
        if (!m.pair) continue;
        yield {
          ref: { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "rr", pair: m.pair } },
          match: m,
          tree: treeTag,
        };
      }
    }
  }
}

function* iterateAllMatches(state: AppState): IterableIterator<{
  ref: ActiveMatchRef;
  match: Match;
  sub: Subcategory;
  category: Category;
  tree: "KATA" | "COMBAT";
}> {
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      for (const it of iterateSubcategoryMatches(catId, sub)) {
        yield { ref: it.ref, match: it.match, sub, category: cat, tree: it.tree };
      }
    }
  }
}

// =============================================================
// Engine state initialisation.
// =============================================================

export function buildInitialEngineState(): EngineState {
  return {
    config: { ...DEFAULT_ENGINE_CONFIG },
    areas: [],
    matches: {},
    competitors: {},
    subcategories: {},
    nextMatchPerArea: {},
    assignmentQueue: [],
    lastTickTs: 0,
  };
}

/** Ensure `state.engine` exists and `engine.areas` matches `areaCount`. */
export function ensureEngineState(state: AppState): EngineState {
  if (!state.engine) state.engine = buildInitialEngineState();
  const eng = state.engine;
  // Backfill any config fields missing from older persisted state.
  eng.config = { ...DEFAULT_ENGINE_CONFIG, ...eng.config };
  const areaCount = state.tournament.settings.areaCount;
  if (eng.areas.length !== areaCount) {
    const next: AreaRuntime[] = [];
    for (let i = 0; i < areaCount; i++) {
      const prev = eng.areas[i];
      next.push(
        prev ?? {
          index: i,
          name: areaLabel(i),
          status: "LIBRE",
          assignedSubcategories: [],
          matchHistory: [],
          firstMatchAssignedTs: null,
          throughput: null,
        }
      );
    }
    eng.areas = next;
    // Drop any nextMatchPerArea entries for removed areas.
    const filtered: Record<number, NextMatchHint | null> = {};
    for (let i = 0; i < areaCount; i++) filtered[i] = eng.nextMatchPerArea[i] ?? null;
    eng.nextMatchPerArea = filtered;
  }
  return eng;
}

// =============================================================
// Hydrate the runtime tables from the bracket.
// =============================================================

function readinessFromBracket(m: Match): { knownA: boolean; knownB: boolean; isBye: boolean; completed: boolean } {
  const knownA = !!m.p1;
  const knownB = !!m.p2;
  const completed = !!m.winner;
  // We do not synthesize BYE here — the bracket builder elides BYEs by
  // pre-populating winners. A nominal BYE marker is preserved if `p2 === "BYE"`.
  const isBye = m.p2 === "BYE" || m.p1 === "BYE";
  return { knownA, knownB, isBye, completed };
}

/**
 * Rebuild the matches/competitors/subcategories tables from the bracket.
 * Preserves any existing runtime fields (startTs, endTs, lastMatchEndTs).
 */
export function hydrateEngineFromBracket(state: AppState, now: number): EngineState {
  const eng = ensureEngineState(state);

  // ---- Subcategories ----
  const subSeen = new Set<string>();
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      subSeen.add(sub.id);
      if (!eng.subcategories[sub.id]) {
        eng.subcategories[sub.id] = {
          id: sub.id,
          checkInStatus: "OPEN",
          checkInClosedTs: null,
          officialStartTs: null,
          actualStartTs: null,
          completedTs: null,
          waitingSince: null,
          assignedAreaIndices: [],
          absentCompetitors: [],
        };
      }
    }
  }
  // Drop runtimes for subcategories that no longer exist.
  for (const id of Object.keys(eng.subcategories)) {
    if (!subSeen.has(id)) delete eng.subcategories[id];
  }

  // ---- Competitors ----
  const compSeen = new Set<string>();
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      for (const name of sub.competitors) {
        if (!name) continue;
        compSeen.add(name);
        if (!eng.competitors[name]) {
          eng.competitors[name] = {
            id: name,
            status: "AVAILABLE",
            lastMatchEndTs: null,
            lastAreaIndex: null,
            currentAreaIndex: null,
          };
        }
      }
    }
  }
  for (const id of Object.keys(eng.competitors)) {
    if (!compSeen.has(id)) delete eng.competitors[id];
  }

  // ---- Matches ----
  const matchSeen = new Set<string>();
  for (const it of iterateAllMatches(state)) {
    const id = matchIdFromRef(it.ref);
    matchSeen.add(id);
    const existing = eng.matches[id];
    const r = readinessFromBracket(it.match);
    const tree = it.tree;
    let status: MatchStatus;
    if (r.completed) status = "COMPLETED";
    else if (existing?.status === "IN_PROGRESS") status = "IN_PROGRESS";
    else if (r.knownA && r.knownB && !r.isBye) status = "READY";
    else status = "PENDING";

    eng.matches[id] = {
      id,
      ref: it.ref,
      discipline: it.ref.discipline,
      bracketTree: tree,
      status,
      assignedAreaIndex: existing?.assignedAreaIndex ?? null,
      startTs: existing?.startTs ?? null,
      endTs: existing?.endTs ?? null,
      isBye: r.isBye,
    };
  }
  for (const id of Object.keys(eng.matches)) {
    if (!matchSeen.has(id)) delete eng.matches[id];
  }

  // Refresh competitor statuses from rest timer.
  for (const c of Object.values(eng.competitors)) {
    refreshCompetitorStatus(c, eng, now);
  }

  // Refresh area statuses using relative throughput vs the global average.
  const globalAvg = computeGlobalAverageThroughput(
    eng.areas, now, eng.config.throughputWarmupMatches,
  );
  for (const a of eng.areas) {
    a.status = computeAreaStatus(a, eng.config, now, globalAvg);
  }

  // Refresh per-subcategory pace.
  for (const subId of Object.keys(eng.subcategories)) {
    const sub = eng.subcategories[subId]!;
    computeSubcategoryPace(sub, eng, state, now);
  }

  // Auto-push: any sub now in the "behind" tier with no IN_PROGRESS matches
  // gets moved to the area with the lightest remaining LPT load — provided
  // the destination is materially lighter (so we don't thrash on noise).
  redistributeBehindSubcategories(state, eng);

  return eng;
}

function redistributeBehindSubcategories(state: AppState, eng: EngineState): void {
  const areaCount = state.tournament.settings.areaCount;
  if (areaCount <= 1) return;

  // Compute remaining-match load per area from current bracket state.
  const loads = new Array(areaCount).fill(0) as number[];
  const subById = new Map<string, import("./types").Subcategory>();
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      subById.set(sub.id, sub);
      const areaIdx = state.tournament.areaAssignments[sub.id];
      if (typeof areaIdx === "number" && areaIdx >= 0 && areaIdx < areaCount) {
        const total = estimatedMatchCount(sub);
        const completed = countCompletedForSub(eng, sub.id);
        loads[areaIdx] += Math.max(0, total - completed);
      }
    }
  }

  for (const [subId, runtime] of Object.entries(eng.subcategories)) {
    if (runtime.paceTier !== "behind") continue;
    if (hasInProgressMatch(eng, subId)) continue;
    const currentArea = state.tournament.areaAssignments[subId];
    if (typeof currentArea !== "number") continue;
    const sub = subById.get(subId);
    if (!sub) continue;
    const remaining = Math.max(0, estimatedMatchCount(sub) - countCompletedForSub(eng, subId));
    if (remaining <= 0) continue;

    // Pick the lightest OTHER area.
    let best = -1;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (let i = 0; i < areaCount; i++) {
      if (i === currentArea) continue;
      if (loads[i]! < bestLoad) {
        bestLoad = loads[i]!;
        best = i;
      }
    }
    if (best < 0) continue;
    // Require materially-lighter destination (>= 2 fewer matches) to avoid
    // bouncing on tiny load deltas.
    if (bestLoad + 2 > loads[currentArea]!) continue;
    state.tournament.areaAssignments[subId] = best;
    loads[currentArea] -= remaining;
    loads[best] += remaining;
  }
}

function countCompletedForSub(eng: EngineState, subId: string): number {
  let n = 0;
  for (const m of Object.values(eng.matches)) {
    if (m.ref.subcategoryId === subId && m.status === "COMPLETED") n++;
  }
  return n;
}

function hasInProgressMatch(eng: EngineState, subId: string): boolean {
  for (const m of Object.values(eng.matches)) {
    if (m.ref.subcategoryId === subId && m.status === "IN_PROGRESS") return true;
  }
  return false;
}

/**
 * Compute the pace delta (seconds, signed) and tier bucket for a single
 * running subcategory. Writes both fields onto the runtime entry.
 *
 * Pace model:
 *   expectedSeconds = totalMatches * avgMatchDurationSeconds
 *   elapsedSeconds  = now - actualStartTs
 *   progress        = completed / totalMatches
 *   pacedElapsed    = progress * expectedSeconds
 *   paceDelta       = elapsedSeconds - pacedElapsed  // positive = behind
 *
 * A subcategory that has run 5 of 10 matches in 18 minutes (avg 3min/match,
 * expected 30min) has progress 0.5 → pacedElapsed 15min → paceDelta +3min.
 */
function computeSubcategoryPace(
  sub: import("./engine-types").SubcategoryRuntime,
  eng: EngineState,
  state: AppState,
  now: number,
): void {
  if (!sub.actualStartTs) {
    sub.paceDeltaSeconds = null;
    sub.paceTier = null;
    return;
  }
  // Find the live subcategory to count its match population.
  let totalMatches = 0;
  let completedMatches = 0;
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    const found = cat.subcategories.find((s) => s.id === sub.id);
    if (!found) continue;
    // Re-use the LPT estimator so the divisor matches the planner's view.
    totalMatches = estimatedMatchCount(found);
    break;
  }
  if (totalMatches <= 0) {
    sub.paceDeltaSeconds = null;
    sub.paceTier = null;
    return;
  }
  for (const m of Object.values(eng.matches)) {
    if (m.ref.subcategoryId !== sub.id) continue;
    if (m.status === "COMPLETED") completedMatches += 1;
  }
  const avg = Math.max(1, eng.config.avgMatchDurationSeconds);
  const expectedTotalSeconds = totalMatches * avg;
  const elapsedSeconds = (now - sub.actualStartTs) / 1000;
  const progress = Math.min(1, completedMatches / totalMatches);
  const pacedElapsed = progress * expectedTotalSeconds;
  const delta = elapsedSeconds - pacedElapsed;
  sub.paceDeltaSeconds = Math.round(delta);

  // Bucket the ratio against the expected total so a 5-match subcategory
  // and a 50-match subcategory get comparable tiers.
  const norm = delta / expectedTotalSeconds;
  if (norm < -0.10) sub.paceTier = "ahead";
  else if (norm <= 0.10) sub.paceTier = "ontime";
  else if (norm <= 0.25) sub.paceTier = "warn";
  else sub.paceTier = "behind";
}

function refreshCompetitorStatus(
  c: CompetitorRuntime,
  eng: EngineState,
  now: number
): CompetitorStatus {
  if (c.status === "ABSENT") return "ABSENT";
  // IN_MATCH is set by recordMatchStart and only cleared by recordMatchEnd.
  if (c.status === "IN_MATCH") return "IN_MATCH";
  if (c.lastMatchEndTs && now - c.lastMatchEndTs < eng.config.minRestSeconds * 1000) {
    c.status = "RESTING";
    return "RESTING";
  }
  c.status = "AVAILABLE";
  return "AVAILABLE";
}

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

// =============================================================
// Match ready evaluation (uses live bracket data via `state`).
// =============================================================

function getMatchParticipants(state: AppState, ref: ActiveMatchRef): { a: string | null; b: string | null } {
  const sub = getSubcategory(state, ref.categoryId, ref.subcategoryId);
  if (!sub) return { a: null, b: null };
  const tree = sub.trees[ref.discipline];
  if (!tree) return { a: null, b: null };
  if (sub.type === "standard") {
    const t = tree as StandardTree;
    if (ref.path.kind === "std") return { a: t.rounds[ref.path.round]?.[ref.path.idx]?.p1 ?? null, b: t.rounds[ref.path.round]?.[ref.path.idx]?.p2 ?? null };
    if (ref.path.kind === "3rd" && t.thirdPlace) return { a: t.thirdPlace.p1, b: t.thirdPlace.p2 };
  } else if (sub.type === "playin") {
    const t = tree as PlayinTree;
    if (ref.path.kind === "playin") return { a: t.extra.p1, b: t.extra.p2 };
    if (ref.path.kind === "std") return { a: t.bracket.rounds[ref.path.round]?.[ref.path.idx]?.p1 ?? null, b: t.bracket.rounds[ref.path.round]?.[ref.path.idx]?.p2 ?? null };
  } else if (sub.type === "series") {
    const t = tree as SeriesTree;
    if (ref.path.kind === "series") return { a: t.matches[ref.path.idx]?.p1 ?? null, b: t.matches[ref.path.idx]?.p2 ?? null };
  } else if (sub.type === "roundrobin") {
    const t = tree as RRTree;
    if (ref.path.kind === "rr") {
      const pair = ref.path.pair;
      const target = t.matches.find((mm) => mm.pair === pair);
      return { a: target?.p1 ?? null, b: target?.p2 ?? null };
    }
  }
  return { a: null, b: null };
}

/** True iff both competitors satisfy the rest restriction. */
function restOk(eng: EngineState, a: string | null, b: string | null, now: number): boolean {
  const minMs = eng.config.minRestSeconds * 1000;
  for (const name of [a, b]) {
    if (!name || name === "BYE") continue;
    const c = eng.competitors[name];
    if (!c) continue;
    if (c.status === "IN_MATCH") return false;
    if (c.lastMatchEndTs && now - c.lastMatchEndTs < minMs) return false;
  }
  return true;
}

/** True iff KATA ordering is satisfied (no pending KATA blockers in this sub). */
function kataOrderingOk(
  state: AppState,
  eng: EngineState,
  subcategoryId: string,
  discipline: Discipline,
  a: string | null,
  b: string | null
): boolean {
  if (discipline !== "combat") return true;
  // Walk this subcategory's KATA tree and count pending matches for each
  // competitor. If any are pending, COMBAT is blocked for that competitor.
  for (const name of [a, b]) {
    if (!name) continue;
    let pending = 0;
    for (const m of Object.values(eng.matches)) {
      if (m.ref.subcategoryId !== subcategoryId) continue;
      if (m.bracketTree !== "KATA") continue;
      if (m.status === "COMPLETED") continue;
      const parts = getMatchParticipants(state, m.ref);
      if (parts.a === name || parts.b === name) pending++;
    }
    if (pending > 0) return false;
  }
  return true;
}

export interface ReadyMatchView {
  runtime: MatchRuntime;
  ref: ActiveMatchRef;
  a: string;
  b: string;
}

/** All matches currently eligible to be assigned to an area. */
export function listReadyMatches(state: AppState, now: number): ReadyMatchView[] {
  const eng = ensureEngineState(state);
  const out: ReadyMatchView[] = [];
  for (const m of Object.values(eng.matches)) {
    if (m.status !== "READY") continue;
    const parts = getMatchParticipants(state, m.ref);
    if (!parts.a || !parts.b) continue;
    if (parts.a === "BYE" || parts.b === "BYE") continue;
    if (!restOk(eng, parts.a, parts.b, now)) continue;
    if (!kataOrderingOk(state, eng, m.ref.subcategoryId, m.ref.discipline, parts.a, parts.b)) continue;
    out.push({ runtime: m, ref: m.ref, a: parts.a, b: parts.b });
  }
  return out;
}

// =============================================================
// (area, match) scoring + assignment.
// =============================================================

interface PairScoreContext {
  state: AppState;
  eng: EngineState;
  now: number;
}

function scorePair(ctx: PairScoreContext, area: AreaRuntime, m: ReadyMatchView): number {
  const cfg = ctx.eng.config;
  let score = 0;
  if (area.assignedSubcategories.includes(m.ref.subcategoryId)) {
    score += cfg.scoreContinuityBonus;
  }
  if (area.status === "LIBRE") score += cfg.scoreFreeAreaBonus;
  if (area.status === "RETRASADA") score += cfg.scoreDelayPenalty;

  // Adjacency to where competitors were last seen.
  const compA = ctx.eng.competitors[m.a];
  const compB = ctx.eng.competitors[m.b];
  for (const c of [compA, compB]) {
    if (!c || c.lastAreaIndex === null) continue;
    if (Math.abs(c.lastAreaIndex - area.index) === 1) {
      score += cfg.scoreAdjacencyBonus;
      break;
    }
  }

  // Critical path: pending matches in this subcategory > some threshold = critical.
  const subRuntime = ctx.eng.subcategories[m.ref.subcategoryId];
  if (subRuntime?.waitingSince) {
    // Aging — older waitingSince scores higher.
    const ageMs = ctx.now - subRuntime.waitingSince;
    if (ageMs > 60_000) score += cfg.scoreAgingBonus;
  }

  // A coarse critical-path proxy: matches in later rounds advance more sub-work.
  if (m.ref.path.kind === "std" && m.ref.path.round > 0) {
    score += cfg.scoreCriticalPathBonus;
  }
  return score;
}

// =============================================================
// runEngineTick — the main entrypoint.
// =============================================================

export interface EngineTickOptions {
  /** Override `Date.now()` (useful for tests). */
  now?: number;
}

export function runEngineTick(state: AppState, opts: EngineTickOptions = {}): EngineState {
  const now = opts.now ?? Date.now();
  const eng = hydrateEngineFromBracket(state, now);
  eng.lastTickTs = now;

  // Drop area assignments referencing matches that no longer exist or have
  // been completed.
  for (const a of eng.areas) {
    a.assignedSubcategories = a.assignedSubcategories.filter((subId) => {
      const sub = eng.subcategories[subId];
      if (!sub) return false;
      if (sub.completedTs) return false;
      return true;
    });
  }

  // Compute candidate matches per area by scoring; pick best per area.
  const ready = listReadyMatches(state, now);
  const ctx: PairScoreContext = { state, eng, now };
  const usedMatchIds = new Set<string>();

  // Reset hints first.
  for (let i = 0; i < eng.areas.length; i++) eng.nextMatchPerArea[i] = null;

  // For each area (in delay-priority order: LIBRE first, then ACTIVA, then RETRASADA),
  // pick the highest-scoring ready match.
  const areasByPriority = [...eng.areas].sort((x, y) => {
    const order = (s: AreaStatus) => (s === "LIBRE" ? 0 : s === "ACTIVA" ? 1 : 2);
    return order(x.status) - order(y.status);
  });

  const disabledAreaSet = new Set(state.tournament.disabledAreas ?? []);
  for (const area of areasByPriority) {
    // Operator-disabled area: leave nextMatchPerArea[i] = null so no new
    // match is queued there. Already-running matches stay; this just
    // stops the engine from sending more.
    if (disabledAreaSet.has(area.index)) continue;
    let best: { match: ReadyMatchView; score: number } | null = null;
    for (const m of ready) {
      if (usedMatchIds.has(m.runtime.id)) continue;
      const sc = scorePair(ctx, area, m);
      if (!best || sc > best.score) best = { match: m, score: sc };
    }
    if (best) {
      usedMatchIds.add(best.match.runtime.id);
      const isInterleaved = !area.assignedSubcategories.includes(best.match.ref.subcategoryId)
        && area.assignedSubcategories.length > 0;
      const primary = isInterleaved ? area.assignedSubcategories[0] : null;
      eng.nextMatchPerArea[area.index] = {
        matchId: best.match.runtime.id,
        isInterleaved,
        primarySubcategoryId: primary,
      };
    }
  }

  return eng;
}

// =============================================================
// Lifecycle helpers (called from the server when actions land).
// =============================================================

/** Mark a subcategory's check-in as closed; enqueue it for assignment. */
export function closeCheckIn(state: AppState, subcategoryId: string, now: number): void {
  const eng = ensureEngineState(state);
  const sub = eng.subcategories[subcategoryId];
  if (!sub) return;
  if (sub.checkInStatus === "CLOSED") return;
  sub.checkInStatus = "CLOSED";
  sub.checkInClosedTs = now;
  sub.waitingSince = now;
  if (!eng.assignmentQueue.includes(subcategoryId)) {
    eng.assignmentQueue.push(subcategoryId);
  }
}

/** Record that a match has started in an area. */
export function recordMatchStart(state: AppState, matchId: string, areaIndex: number, now: number): void {
  const eng = ensureEngineState(state);
  const m = eng.matches[matchId];
  if (!m) return;
  m.status = "IN_PROGRESS";
  m.startTs = now;
  m.assignedAreaIndex = areaIndex;
  const area = eng.areas[areaIndex];
  if (area) {
    if (!area.firstMatchAssignedTs) area.firstMatchAssignedTs = now;
    if (!area.assignedSubcategories.includes(m.ref.subcategoryId)) {
      area.assignedSubcategories.push(m.ref.subcategoryId);
    }
  }
  // Flip competitor status to IN_MATCH.
  const parts = getMatchParticipants(state, m.ref);
  for (const name of [parts.a, parts.b]) {
    if (!name || name === "BYE") continue;
    const c = eng.competitors[name];
    if (!c) continue;
    c.status = "IN_MATCH";
    c.currentAreaIndex = areaIndex;
  }
  // Track subcategory's first start.
  const subRuntime = eng.subcategories[m.ref.subcategoryId];
  if (subRuntime && !subRuntime.actualStartTs) subRuntime.actualStartTs = now;
}

/** Record that a match has ended; bump rest timers; recompute. */
export function recordMatchEnd(state: AppState, matchId: string, now: number): void {
  const eng = ensureEngineState(state);
  const m = eng.matches[matchId];
  if (!m) return;
  m.status = "COMPLETED";
  m.endTs = now;
  const areaIdx = m.assignedAreaIndex;
  if (areaIdx !== null) {
    const area = eng.areas[areaIdx];
    if (area && m.startTs) {
      area.matchHistory.push({ matchId, startTs: m.startTs, endTs: now });
    }
  }
  const parts = getMatchParticipants(state, m.ref);
  for (const name of [parts.a, parts.b]) {
    if (!name || name === "BYE") continue;
    const c = eng.competitors[name];
    if (!c) continue;
    c.lastMatchEndTs = now;
    c.lastAreaIndex = areaIdx;
    c.currentAreaIndex = null;
    c.status = "RESTING";
  }
}

/** Mark a competitor ABSENT (operator action). */
export function markCompetitorAbsent(state: AppState, competitorName: string): void {
  const eng = ensureEngineState(state);
  const c = eng.competitors[competitorName];
  if (!c) return;
  c.status = "ABSENT";
}

/** Update one or more engine config fields. */
export function updateEngineConfig(state: AppState, patch: Partial<EngineConfig>): void {
  const eng = ensureEngineState(state);
  eng.config = { ...eng.config, ...patch };
}
