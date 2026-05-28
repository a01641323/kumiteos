import type {
  AppState,
  CategoryDef,
  Discipline,
  MatchState,
  TournamentSettings,
  ActiveMatchRef,
  AnyTree,
  StandardTree,
  PlayinTree,
  SeriesTree,
  RRTree,
  Match,
  Subcategory,
  Category,
  MatchPath,
  MatchResult,
  Participant,
  AreaAssignments,
  SubcategorySize,
} from "./types";
import { DEFAULT_KEYS } from "./data";
import { rebuildCategoriesFromParticipants } from "./categories";
import { rebuildCategorySubcategories } from "./subcategories";
import { arrangeByDojo } from "./dojo-seeding";
import { newParticipantId } from "./csv";
import { defaultCategoryDefs } from "./category-defs";
import { generateRandomSeed } from "./seeding";
import { buildAreaPlan } from "./areas";

export const STORAGE_KEY = "karate-state-v5";
export const TIMER_OWNER_KEY = "karate-timer-owner-v5";
export const CHANNEL_NAME = "karate-state-v5";

export function buildInitialState(): AppState {
  const settings: TournamentSettings = {
    subcategorySize: 4,
    disciplineMode: "combat",
    areaCount: 1,
    pointDifference: 8,
  };
  return {
    tournament: {
      settings,
      categoryDefs: defaultCategoryDefs(),
      participants: [],
      categories: {},
      categoryOrder: [],
      activeCategoryId: null,
      areaAssignments: {},
      meta: {
        seed: generateRandomSeed(),
        logoUrl: null,
      },
    },
    match: {
      blueName: "",
      redName: "",
      bluePoints: 0,
      redPoints: 0,
      blueIppon: 0,
      redIppon: 0,
      blueWasari: 0,
      redWasari: 0,
      blueYuko: 0,
      redYuko: 0,
      bluePenalties: 0,
      redPenalties: 0,
      blueAdvantage: false,
      redAdvantage: false,
      blueEliminated: false,
      redEliminated: false,
      discipline: null,
      activeMatchRef: null,
      tieBreakReason: null,
    },
    timer: {
      duration: 120,
      remaining: 120,
      running: false,
      finished: false,
    },
    settings: {
      defaultDuration: 120,
      keys: { ...DEFAULT_KEYS },
    },
    jury: null,
    engine: undefined,
  };
}

export function loadState(storage: Storage | null): AppState {
  if (!storage) return buildInitialState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return buildInitialState();
    const parsed = JSON.parse(raw) as AppState;
    if (
      !parsed ||
      !parsed.tournament ||
      !parsed.tournament.settings ||
      !Array.isArray(parsed.tournament.participants) ||
      !parsed.match ||
      !parsed.timer ||
      !parsed.settings
    ) {
      return buildInitialState();
    }
    parsed.settings.keys = {
      ...DEFAULT_KEYS,
      ...(parsed.settings.keys ?? {}),
    };
    if (typeof parsed.jury === "undefined") parsed.jury = null;
    if (!Array.isArray(parsed.tournament.categoryDefs) || parsed.tournament.categoryDefs.length === 0) {
      parsed.tournament.categoryDefs = defaultCategoryDefs();
    }
    if (typeof parsed.tournament.settings.areaCount !== "number") {
      parsed.tournament.settings.areaCount = 1;
    }
    if (typeof parsed.tournament.settings.pointDifference === "undefined") {
      parsed.tournament.settings.pointDifference = 8;
    }
    if (!parsed.tournament.areaAssignments || typeof parsed.tournament.areaAssignments !== "object") {
      parsed.tournament.areaAssignments = {};
    }
    if (!parsed.tournament.meta || typeof parsed.tournament.meta !== "object") {
      parsed.tournament.meta = { seed: generateRandomSeed(), logoUrl: null };
    } else {
      if (typeof parsed.tournament.meta.seed !== "number") parsed.tournament.meta.seed = generateRandomSeed();
      if (typeof parsed.tournament.meta.logoUrl === "undefined") parsed.tournament.meta.logoUrl = null;
    }
    // Migrate snapshots that pre-date the check-in flow: participants with
    // no `arrived` flag are treated as arrived, and categories that already
    // have brackets are treated as started. This keeps every existing
    // tournament playable without a manual check-in pass.
    for (const p of parsed.tournament.participants) {
      if (typeof p.arrived === "undefined") p.arrived = true;
    }
    if (parsed.tournament.categories && typeof parsed.tournament.categories === "object") {
      for (const catId of Object.keys(parsed.tournament.categories)) {
        const cat = parsed.tournament.categories[catId];
        if (!cat) continue;
        if (typeof cat.started === "undefined") {
          cat.started = (cat.subcategories?.length ?? 0) > 0;
        }
      }
    }
    return parsed;
  } catch {
    return buildInitialState();
  }
}

// =============================================================
// Lookups
// =============================================================
export function getCategory(state: AppState, catId: string): Category | null {
  return state.tournament.categories[catId] ?? null;
}
export function getSubcategory(
  state: AppState,
  catId: string,
  subId: string
): Subcategory | null {
  const cat = getCategory(state, catId);
  if (!cat) return null;
  return cat.subcategories.find((s) => s.id === subId) ?? null;
}
export function getMatchByRef(
  state: AppState,
  ref: ActiveMatchRef | null
): Match | null {
  if (!ref) return null;
  const sub = getSubcategory(state, ref.categoryId, ref.subcategoryId);
  if (!sub) return null;
  const tree = sub.trees[ref.discipline];
  if (!tree) return null;
  const path = ref.path;
  if (sub.type === "standard") {
    const t = tree as StandardTree;
    if (path.kind !== "std") return null;
    return t.rounds[path.round]?.[path.idx] ?? null;
  }
  if (sub.type === "playin") {
    const t = tree as PlayinTree;
    if (path.kind === "playin") return t.extra;
    if (path.kind !== "std") return null;
    return t.bracket.rounds[path.round]?.[path.idx] ?? null;
  }
  if (sub.type === "series") {
    const t = tree as SeriesTree;
    if (path.kind !== "series") return null;
    return t.matches[path.idx] ?? null;
  }
  if (sub.type === "roundrobin") {
    const t = tree as RRTree;
    if (path.kind !== "rr") return null;
    return t.matches.find((m) => m.pair === path.pair) ?? null;
  }
  return null;
}

// =============================================================
// Status helpers
// =============================================================
export function treeComplete(type: string, tree: AnyTree): boolean {
  if (type === "standard") return !!(tree as StandardTree).champion;
  if (type === "playin") return !!(tree as PlayinTree).bracket.champion;
  if (type === "series") return !!(tree as SeriesTree).winner;
  if (type === "roundrobin") return !!(tree as RRTree).winner;
  return false;
}
export function treeHasProgress(type: string, tree: AnyTree): boolean {
  if (type === "standard")
    return (tree as StandardTree).rounds.some((r) =>
      r.some((m) => m.winner)
    );
  if (type === "playin") {
    const t = tree as PlayinTree;
    if (t.extra.winner) return true;
    return t.bracket.rounds.some((r) => r.some((m) => m.winner));
  }
  if (type === "series" || type === "roundrobin")
    return (tree as SeriesTree | RRTree).matches.some((m) => m.winner);
  return false;
}
export function subcategoryStatus(
  sub: Subcategory
): "pending" | "in-progress" | "complete" {
  const trees = Object.values(sub.trees) as AnyTree[];
  if (trees.length === 0) return "pending";
  const allComplete = trees.every((t) => treeComplete(sub.type, t));
  if (allComplete) return "complete";
  return trees.some((t) => treeHasProgress(sub.type, t))
    ? "in-progress"
    : "pending";
}

// =============================================================
// Mutations: tournament + participants
// =============================================================
export function rebuildAllSubcategories(state: AppState): void {
  // Preserve which categories were already started so their brackets get
  // rebuilt from the arrived roster; new / unstarted ones stay empty.
  const prevStarted = new Set<string>();
  for (const catId of state.tournament.categoryOrder) {
    if (state.tournament.categories[catId]?.started) prevStarted.add(catId);
  }
  const result = rebuildCategoriesFromParticipants(
    state.tournament.participants,
    state.tournament.settings,
    state.tournament.categoryDefs,
    {
      seed: state.tournament.meta.seed,
      prevActiveCategoryId: state.tournament.activeCategoryId,
      prevStarted,
    }
  );
  state.tournament.categories = result.categories;
  state.tournament.categoryOrder = result.categoryOrder;
  state.tournament.activeCategoryId = result.activeCategoryId;
  // Drop area assignments for subcategories that no longer exist; keep the rest.
  const validSubIds = new Set<string>();
  for (const catId of result.categoryOrder) {
    const cat = result.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) validSubIds.add(sub.id);
  }
  const next: AreaAssignments = {};
  for (const [id, idx] of Object.entries(state.tournament.areaAssignments)) {
    if (validSubIds.has(id) && idx < state.tournament.settings.areaCount) {
      next[id] = idx;
    }
  }
  // Re-run the planner so any unassigned subcategories get a sensible default.
  state.tournament.areaAssignments = buildAreaPlan(
    {
      categoryOrder: state.tournament.categoryOrder,
      categories: state.tournament.categories,
      areaCount: state.tournament.settings.areaCount,
      disabledAreas: state.tournament.disabledAreas,
    },
    next
  ).assignments;
}

export function reseed(state: AppState, seed?: number): number {
  const next = typeof seed === "number" ? seed : generateRandomSeed();
  state.tournament.meta.seed = next;
  rebuildAllSubcategories(state);
  resetLiveScoreboard(state);
  state.jury = null;
  return next;
}

// =============================================================
// Category definitions
// =============================================================
export function setCategoryDefs(state: AppState, defs: CategoryDef[]): void {
  state.tournament.categoryDefs = defs.slice();
  rebuildAllSubcategories(state);
}

export function addCategoryDef(state: AppState, def: CategoryDef): void {
  state.tournament.categoryDefs = [...state.tournament.categoryDefs, def];
  rebuildAllSubcategories(state);
}

export function updateCategoryDef(state: AppState, def: CategoryDef): void {
  state.tournament.categoryDefs = state.tournament.categoryDefs.map((d) =>
    d.id === def.id ? def : d
  );
  rebuildAllSubcategories(state);
}

export function removeCategoryDef(state: AppState, defId: string): void {
  state.tournament.categoryDefs = state.tournament.categoryDefs.filter(
    (d) => d.id !== defId
  );
  rebuildAllSubcategories(state);
}

// =============================================================
// Settings + areas
// =============================================================
export function setSubcategorySize(state: AppState, size: SubcategorySize): void {
  state.tournament.settings.subcategorySize = size;
  rebuildAllSubcategories(state);
  resetLiveScoreboard(state);
  state.jury = null;
}

export function setDisciplineMode(state: AppState, mode: TournamentSettings["disciplineMode"]): void {
  state.tournament.settings.disciplineMode = mode;
  rebuildAllSubcategories(state);
  resetLiveScoreboard(state);
  state.jury = null;
}

export function setAreaCount(state: AppState, count: number): void {
  const n = Math.max(1, Math.min(10, Math.floor(count)));
  state.tournament.settings.areaCount = n;
  // Drop any assignments that exceed the new count, then re-plan.
  const filtered: AreaAssignments = {};
  for (const [id, idx] of Object.entries(state.tournament.areaAssignments)) {
    if (idx < n) filtered[id] = idx;
  }
  state.tournament.areaAssignments = buildAreaPlan(
    {
      categoryOrder: state.tournament.categoryOrder,
      categories: state.tournament.categories,
      areaCount: n,
      disabledAreas: state.tournament.disabledAreas,
    },
    filtered
  ).assignments;
}

export function assignSubcategoryToArea(
  state: AppState,
  subcategoryId: string,
  areaIndex: number
): void {
  const n = state.tournament.settings.areaCount;
  if (areaIndex < 0 || areaIndex >= n) return;
  state.tournament.areaAssignments = {
    ...state.tournament.areaAssignments,
    [subcategoryId]: areaIndex,
  };
}

export function setLogoUrl(state: AppState, url: string | null): void {
  state.tournament.meta.logoUrl = url;
}

export function replaceParticipants(
  state: AppState,
  list: Omit<Participant, "id">[]
): void {
  state.tournament.participants = list.map((p) => ({
    ...p,
    id: newParticipantId(),
  }));
  rebuildAllSubcategories(state);
  resetLiveScoreboard(state);
  state.jury = null;
}

export function addParticipant(
  state: AppState,
  p: Omit<Participant, "id">
): void {
  state.tournament.participants.push({ ...p, id: newParticipantId() });
  rebuildAllSubcategories(state);
  resetLiveScoreboard(state);
  state.jury = null;
}

export function removeParticipant(state: AppState, id: string): void {
  state.tournament.participants = state.tournament.participants.filter(
    (p) => p.id !== id
  );
  rebuildAllSubcategories(state);
  resetLiveScoreboard(state);
  state.jury = null;
}

/**
 * Flip a participant's arrival flag. Cheap — does NOT rebuild any bracket.
 * Brackets only change when the operator runs START_CATEGORY.
 */
export function markParticipantArrived(
  state: AppState,
  participantId: string,
  arrived: boolean,
): boolean {
  const p = state.tournament.participants.find((x) => x.id === participantId);
  if (!p) return false;
  p.arrived = arrived;
  return true;
}

/**
 * Lock a category in for the day: drop participants who didn't arrive from
 * its competitors list, build the bracket from the rest, and mark
 * `started: true`. Idempotent on re-call (does nothing if already started).
 *
 * Returns the names that were removed so the caller can log / show them.
 */
export function startCategory(state: AppState, catId: string): string[] {
  const cat = state.tournament.categories[catId];
  if (!cat) return [];
  if (cat.started) return [];
  const eligibleIds = new Set<string>();
  const removedNames: string[] = [];
  for (const p of state.tournament.participants) {
    const def = state.tournament.categoryDefs.find((d) => d.id === catId);
    if (!def) continue;
    // Inline the category match check rather than re-importing
    // findCategoryForParticipant — the def list is small.
    const matchesBelt = def.belts.length === 0 || def.belts.includes(p.beltColor);
    const inAgeRange =
      p.age >= def.minAge && (def.maxAge === null || p.age <= def.maxAge);
    if (!matchesBelt || !inAgeRange) continue;
    if (p.arrived === false) {
      removedNames.push(`${p.nombre} ${p.apellido}`.trim());
    } else {
      eligibleIds.add(p.id);
    }
  }
  // Filter cat.competitors (which currently holds the full seeded roster) to
  // keep only arrived names. We use a Set of full names because that's the
  // shape stored on the category.
  const arrivedNames = new Set(
    state.tournament.participants
      .filter((p) => eligibleIds.has(p.id))
      .map((p) => `${p.nombre} ${p.apellido}`.trim()),
  );
  cat.competitors = cat.competitors.filter((n) => arrivedNames.has(n));
  // Re-run dojo-aware seeding on the actual arrived roster so the
  // separation is optimized for who actually showed up (the full-pool
  // arrangement degrades once no-shows are dropped).
  const dojoByName = new Map<string, string | undefined>();
  for (const p of state.tournament.participants) {
    dojoByName.set(`${p.nombre} ${p.apellido}`.trim(), p.dojo);
  }
  cat.competitors = arrangeByDojo(
    cat.competitors.map((n) => ({ name: n, dojo: dojoByName.get(n) })),
    state.tournament.settings.subcategorySize,
  );
  cat.started = true;
  // Now that we know the real roster, build the subcategories.
  rebuildCategorySubcategories(cat, state.tournament.settings);
  // …and immediately re-run the area planner so the brand-new
  // subcategories pick up area assignments right away. Without this
  // they'd stay unassigned (areaIdx === undefined) until the next
  // reseed or settings change — which is exactly the "I have to make
  // a new seed every time I start a category" friction the operator
  // hit. Keep prior manual assignments; only the new ones get
  // greedily placed onto the lightest-loaded area.
  state.tournament.areaAssignments = buildAreaPlan(
    {
      categoryOrder: state.tournament.categoryOrder,
      categories: state.tournament.categories,
      areaCount: state.tournament.settings.areaCount,
      disabledAreas: state.tournament.disabledAreas,
    },
    state.tournament.areaAssignments,
  ).assignments;
  return removedNames;
}


// =============================================================
// Mutations: scoreboard
// =============================================================
export function captureSb(m: MatchState): MatchResult {
  return {
    p1: {
      name: m.blueName,
      points: m.bluePoints,
      penalties: m.bluePenalties,
      advantage: m.blueAdvantage,
    },
    p2: {
      name: m.redName,
      points: m.redPoints,
      penalties: m.redPenalties,
      advantage: m.redAdvantage,
    },
  };
}

/**
 * Resolve the combat match duration (seconds) for a category: the
 * category's own `matchDurationSeconds` when set, else the
 * tournament-wide default. Used when loading a match to the scoreboard.
 */
export function resolveCategoryDuration(
  state: AppState,
  categoryId: string | null | undefined,
): number {
  if (categoryId) {
    const def = state.tournament.categoryDefs.find((d) => d.id === categoryId);
    const d = def?.matchDurationSeconds;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
  }
  return state.settings.defaultDuration;
}

export function resetLiveScoreboard(state: AppState): void {
  state.match.blueName = "";
  state.match.redName = "";
  state.match.bluePoints = 0;
  state.match.redPoints = 0;
  state.match.blueIppon = 0;
  state.match.redIppon = 0;
  state.match.blueWasari = 0;
  state.match.redWasari = 0;
  state.match.blueYuko = 0;
  state.match.redYuko = 0;
  state.match.bluePenalties = 0;
  state.match.redPenalties = 0;
  state.match.blueAdvantage = false;
  state.match.redAdvantage = false;
  state.match.blueEliminated = false;
  state.match.redEliminated = false;
  state.match.discipline = null;
  state.match.activeMatchRef = null;
  state.match.tieBreakReason = null;
  state.timer.duration = state.settings.defaultDuration;
  state.timer.remaining = state.settings.defaultDuration;
  state.timer.running = false;
  state.timer.finished = false;
}

export function loadMatchToScoreboardImpl(
  state: AppState,
  ref: ActiveMatchRef
): boolean {
  const m = getMatchByRef(state, ref);
  if (!m || !m.p1 || !m.p2 || m.winner) return false;
  state.match.blueName = m.p1;
  state.match.redName = m.p2;
  state.match.bluePoints = 0;
  state.match.redPoints = 0;
  state.match.blueIppon = 0;
  state.match.redIppon = 0;
  state.match.blueWasari = 0;
  state.match.redWasari = 0;
  state.match.blueYuko = 0;
  state.match.redYuko = 0;
  state.match.bluePenalties = 0;
  state.match.redPenalties = 0;
  state.match.blueAdvantage = false;
  state.match.redAdvantage = false;
  state.match.blueEliminated = false;
  state.match.redEliminated = false;
  state.match.tieBreakReason = null;
  state.match.discipline = ref.discipline;
  state.match.activeMatchRef = ref;
  const dur = resolveCategoryDuration(state, ref.categoryId);
  state.timer.duration = dur;
  state.timer.remaining = dur;
  state.timer.running = false;
  state.timer.finished = false;
  return true;
}

// =============================================================
// Mutations: bracket finalization
// =============================================================
export function propagateBracketWinner(
  bracket: StandardTree,
  round: number,
  idx: number,
  winnerName: string
): void {
  if (round + 1 < bracket.rounds.length) {
    const next = bracket.rounds[round + 1][Math.floor(idx / 2)];
    if (idx % 2 === 0) next.p1 = winnerName;
    else next.p2 = winnerName;
  } else {
    bracket.champion = winnerName;
  }
}

export function finalizeMatchByRef(
  state: AppState,
  ref: ActiveMatchRef,
  winnerName: string,
  loserName: string,
  juryUsed: boolean
): void {
  const sub = getSubcategory(state, ref.categoryId, ref.subcategoryId);
  if (!sub) return;
  const tree = sub.trees[ref.discipline];
  if (!tree) return;
  const m = getMatchByRef(state, ref);
  if (!m) return;
  m.winner = winnerName;
  m.eliminated = loserName;
  m.jury = juryUsed;
  m.result = captureSb(state.match);

  if (sub.type === "standard") {
    if (ref.path.kind === "std") {
      propagateBracketWinner(
        tree as StandardTree,
        ref.path.round,
        ref.path.idx,
        winnerName
      );
    }
  } else if (sub.type === "playin") {
    const t = tree as PlayinTree;
    if (ref.path.kind === "playin") {
      const r0 = t.bracket.rounds[0];
      r0[r0.length - 1].p2 = winnerName;
    } else if (ref.path.kind === "std") {
      propagateBracketWinner(
        t.bracket,
        ref.path.round,
        ref.path.idx,
        winnerName
      );
    }
  } else if (sub.type === "series") {
    const t = tree as SeriesTree;
    if (t.matches.every((mm) => mm.winner)) {
      finalizeSeries(state, sub, ref.discipline);
    }
  } else if (sub.type === "roundrobin") {
    const t = tree as RRTree;
    if (t.matches.every((mm) => mm.winner)) {
      finalizeRR(state, sub, ref.discipline);
    }
  }
  // NB: do NOT resetLiveScoreboard here. The just-finished match must
  // stay on the board until the operator presses Enter / Advance.
  // Callers that intend to roll forward call loadMatchToScoreboardImpl
  // (which overwrites every field) right after this.
}

export function finalizeSeries(
  state: AppState,
  sub: Subcategory,
  discipline: Discipline
): "jury" | null {
  const tree = sub.trees[discipline] as SeriesTree;
  const [a, b] = sub.competitors;
  const winsA = tree.matches.filter((m) => m.winner === a).length;
  const winsB = tree.matches.filter((m) => m.winner === b).length;
  if (winsA === 2) {
    tree.winner = a;
    return null;
  }
  if (winsB === 2) {
    tree.winner = b;
    return null;
  }
  const totals: Record<string, number> = { [a]: 0, [b]: 0 };
  const pens: Record<string, number> = { [a]: 0, [b]: 0 };
  const sens: Record<string, number> = { [a]: 0, [b]: 0 };
  for (const m of tree.matches) {
    if (!m.result) continue;
    totals[m.p1!] += m.result.p1.points;
    totals[m.p2!] += m.result.p2.points;
    pens[m.p1!] += m.result.p1.penalties;
    pens[m.p2!] += m.result.p2.penalties;
    if (m.result.p1.advantage) sens[m.p1!]++;
    if (m.result.p2.advantage) sens[m.p2!]++;
  }
  if (totals[a] !== totals[b]) {
    tree.winner = totals[a] > totals[b] ? a : b;
    return null;
  }
  if (pens[a] !== pens[b]) {
    tree.winner = pens[a] < pens[b] ? a : b;
    return null;
  }
  if (sens[a] !== sens[b]) {
    tree.winner = sens[a] > sens[b] ? a : b;
    return null;
  }
  state.jury = {
    competitors: [a, b],
    context: {
      kind: "series-final",
      subRef: {
        categoryId: sub.categoryId,
        subcategoryId: sub.id,
        discipline,
      },
    },
  };
  return "jury";
}

export function finalizeRR(
  state: AppState,
  sub: Subcategory,
  discipline: Discipline
): "jury" | null {
  const tree = sub.trees[discipline] as RRTree;
  const comps = sub.competitors;
  const stats: Record<
    string,
    { name: string; w: number; l: number; pts: number; pen: number; senshu: number }
  > = {};
  for (const n of comps)
    stats[n] = { name: n, w: 0, l: 0, pts: 0, pen: 0, senshu: 0 };
  for (const m of tree.matches) {
    if (!m.result) continue;
    stats[m.p1!].pts += m.result.p1.points;
    stats[m.p2!].pts += m.result.p2.points;
    stats[m.p1!].pen += m.result.p1.penalties;
    stats[m.p2!].pen += m.result.p2.penalties;
    if (m.result.p1.advantage) stats[m.p1!].senshu++;
    if (m.result.p2.advantage) stats[m.p2!].senshu++;
    if (m.winner === m.p1) {
      stats[m.p1!].w++;
      stats[m.p2!].l++;
    } else if (m.winner === m.p2) {
      stats[m.p2!].w++;
      stats[m.p1!].l++;
    }
  }
  const ranked = comps
    .map((n) => stats[n])
    .sort((x, y) => {
      if (y.w !== x.w) return y.w - x.w;
      if (y.pts !== x.pts) return y.pts - x.pts;
      if (x.pen !== y.pen) return x.pen - y.pen;
      if (y.senshu !== x.senshu) return y.senshu - x.senshu;
      return 0;
    });
  tree.rankings = ranked;
  const top = ranked[0];
  const tied = ranked.filter(
    (r) =>
      r.w === top.w &&
      r.pts === top.pts &&
      r.pen === top.pen &&
      r.senshu === top.senshu
  );
  if (tied.length > 1) {
    state.jury = {
      competitors: [tied[0].name, tied[1].name],
      context: {
        kind: "rr-final",
        subRef: {
          categoryId: sub.categoryId,
          subcategoryId: sub.id,
          discipline,
        },
      },
    };
    return "jury";
  }
  tree.winner = top.name;
  return null;
}

// =============================================================
// Misc
// =============================================================
export function describeRefLabel(
  state: AppState,
  ref: ActiveMatchRef
): string {
  const sub = getSubcategory(state, ref.categoryId, ref.subcategoryId);
  if (!sub) return "?";
  const d =
    Object.keys(sub.trees).length > 1
      ? ref.discipline.charAt(0).toUpperCase() + " · "
      : "";
  if (ref.path.kind === "playin") return d + "Play-in · " + sub.label;
  if (ref.path.kind === "series")
    return d + sub.label + " M" + (ref.path.idx + 1);
  if (ref.path.kind === "rr") {
    const map = { ab: "A vs B", ac: "A vs C", bc: "B vs C" } as const;
    return d + sub.label + " · " + map[ref.path.pair];
  }
  if (ref.path.kind === "std") {
    const tree =
      sub.type === "playin"
        ? (sub.trees[ref.discipline] as PlayinTree).bracket
        : (sub.trees[ref.discipline] as StandardTree);
    const total = tree.rounds.length;
    return (
      d +
      sub.label +
      " · " +
      roundLabel(ref.path.round, total) +
      " M" +
      (ref.path.idx + 1)
    );
  }
  return d + sub.label;
}

export function roundLabel(roundIdx: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinal";
  if (fromEnd === 2) return "Quarterfinal";
  if (fromEnd === 3) return "Round of 16";
  return `Round ${roundIdx + 1}`;
}

export function samePath(a: MatchPath | undefined, b: MatchPath | undefined): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "std" && b.kind === "std")
    return a.round === b.round && a.idx === b.idx;
  if (a.kind === "series" && b.kind === "series") return a.idx === b.idx;
  if (a.kind === "rr" && b.kind === "rr") return a.pair === b.pair;
  if (a.kind === "playin" && b.kind === "playin") return true;
  return false;
}
