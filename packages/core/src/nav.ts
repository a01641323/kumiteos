import type {
  ActiveMatchRef,
  AppState,
  Discipline,
  Match,
  PlayinTree,
  RRTree,
  SeriesTree,
  StandardTree,
  Subcategory,
} from "./types";
import { subcategoryStatus } from "./state";

/**
 * Walk the tournament structure looking for the next playable match — i.e.
 * the next match where both p1 and p2 are filled and there is no winner yet.
 *
 * Search order:
 *   1. Same subcategory + discipline as `from`, after the from-path.
 *   2. Same subcategory, other disciplines (when discipline mode is "both").
 *   3. Other subcategories in the same category, in array order.
 *   4. Other categories, in `categoryOrder` order.
 *
 * Returns null when no playable match remains anywhere.
 */
export function findNextMatch(
  state: AppState,
  from: ActiveMatchRef
): ActiveMatchRef | null {
  const order = state.tournament.categoryOrder;
  const startCatIdx = Math.max(0, order.indexOf(from.categoryId));
  for (let i = 0; i < order.length; i++) {
    const catId = order[(startCatIdx + i) % order.length];
    if (!catId) continue;
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    const startSubIdx =
      i === 0
        ? Math.max(0, cat.subcategories.findIndex((s) => s.id === from.subcategoryId))
        : 0;
    for (let j = 0; j < cat.subcategories.length; j++) {
      const sub = cat.subcategories[(startSubIdx + j) % cat.subcategories.length];
      if (!sub) continue;
      const sameSub = sub.id === from.subcategoryId && i === 0 && j === 0;
      const found = findInSubcategory(sub, sameSub ? from : null);
      if (found) {
        return {
          categoryId: catId,
          subcategoryId: sub.id,
          discipline: found.discipline,
          path: found.path as ActiveMatchRef["path"],
        };
      }
    }
  }
  return null;
}

interface SubMatchHit {
  discipline: Discipline;
  path: ActiveMatchRef["path"];
}

function findInSubcategory(
  sub: Subcategory,
  fromRef: ActiveMatchRef | null
): SubMatchHit | null {
  const disciplines = Object.keys(sub.trees) as Discipline[];
  // Make sure the active discipline (or fromRef's) is searched first.
  if (fromRef) {
    disciplines.sort((a, b) =>
      a === fromRef.discipline ? -1 : b === fromRef.discipline ? 1 : 0
    );
  } else {
    disciplines.sort((a, b) =>
      a === sub.activeDiscipline ? -1 : b === sub.activeDiscipline ? 1 : 0
    );
  }
  for (let di = 0; di < disciplines.length; di++) {
    const d = disciplines[di]!;
    const tree = sub.trees[d];
    if (!tree) continue;
    const isPrimary = !!fromRef && di === 0;
    const path = walkTreeForNextMatch(sub, tree, isPrimary ? fromRef : null);
    if (path) return { discipline: d, path };
  }
  return null;
}

function walkTreeForNextMatch(
  sub: Subcategory,
  tree: StandardTree | PlayinTree | SeriesTree | RRTree,
  fromRef: ActiveMatchRef | null
): ActiveMatchRef["path"] | null {
  if (sub.type === "standard") {
    return walkStandardTree(tree as StandardTree, fromRef);
  }
  if (sub.type === "playin") {
    const t = tree as PlayinTree;
    if (
      (!fromRef || fromRef.path.kind !== "playin" && fromRef.path.kind !== "std") &&
      isPlayable(t.extra)
    ) {
      return { kind: "playin" };
    }
    if (!fromRef || fromRef.path.kind === "playin") {
      if (isPlayable(t.extra)) return { kind: "playin" };
    }
    return walkStandardTree(t.bracket, fromRef);
  }
  if (sub.type === "series") {
    const t = tree as SeriesTree;
    const startIdx =
      fromRef && fromRef.path.kind === "series" ? fromRef.path.idx + 1 : 0;
    for (let i = startIdx; i < t.matches.length; i++) {
      if (isPlayable(t.matches[i]!)) return { kind: "series", idx: i };
    }
    if (!fromRef || fromRef.path.kind !== "series") {
      for (let i = 0; i < t.matches.length; i++) {
        if (isPlayable(t.matches[i]!)) return { kind: "series", idx: i };
      }
    }
    return null;
  }
  if (sub.type === "roundrobin") {
    const t = tree as RRTree;
    const order: ("ab" | "ac" | "bc")[] = ["ab", "ac", "bc"];
    const startIdx =
      fromRef && fromRef.path.kind === "rr"
        ? Math.max(0, order.indexOf(fromRef.path.pair) + 1)
        : 0;
    for (let i = startIdx; i < order.length; i++) {
      const pair = order[i]!;
      const m = t.matches.find((mm) => mm.pair === pair);
      if (m && isPlayable(m)) return { kind: "rr", pair };
    }
    if (!fromRef || fromRef.path.kind !== "rr") {
      for (const pair of order) {
        const m = t.matches.find((mm) => mm.pair === pair);
        if (m && isPlayable(m)) return { kind: "rr", pair };
      }
    }
    return null;
  }
  return null;
}

function walkStandardTree(
  tree: StandardTree,
  fromRef: ActiveMatchRef | null
): ActiveMatchRef["path"] | null {
  const startRound = fromRef && fromRef.path.kind === "std" ? fromRef.path.round : 0;
  const startIdx =
    fromRef && fromRef.path.kind === "std" ? fromRef.path.idx + 1 : 0;
  for (let r = startRound; r < tree.rounds.length; r++) {
    const round = tree.rounds[r]!;
    const begin = r === startRound ? startIdx : 0;
    for (let i = begin; i < round.length; i++) {
      if (isPlayable(round[i]!)) return { kind: "std", round: r, idx: i };
    }
  }
  if (tree.thirdPlace && isPlayable(tree.thirdPlace)) {
    return { kind: "3rd" };
  }
  return null;
}

function isPlayable(m: Match): boolean {
  return !!m.p1 && !!m.p2 && !m.winner;
}

/** Returns true once every subcategory in the tournament has reached "complete". */
export function allMatchesComplete(state: AppState): boolean {
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    if (cat.subcategories.length === 0) continue;
    for (const sub of cat.subcategories) {
      if (subcategoryStatus(sub) !== "complete") return false;
    }
  }
  return true;
}
