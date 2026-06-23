import type { AreaAssignments, Category, Subcategory } from "./types";

/**
 * Conservative match-count estimate per subcategory shape. Used by
 * buildAreaPlan's LPT scheduler to balance throughput rather than raw
 * subcategory count.
 *
 * Worst-case bias is preferred — better to over-allocate a heavy
 * subcategory than under-allocate it and finish that area late.
 */
export function estimatedMatchCount(sub: Subcategory): number {
  const n = Math.max(sub.competitors.length, 1);
  switch (sub.type) {
    case "standard":
      // Binary bracket: n - 1 elimination matches. Add 1 for the 3rd-place
      // playoff that fires when n >= 4.
      return Math.max(1, n - 1) + (n >= 4 ? 1 : 0);
    case "playin":
      // One extra play-in match plus a standard bracket of size = the
      // configured subcategorySize. The play-in resolves the surplus
      // competitor before the bracket starts.
      return 1 + Math.max(1, (n - 1) - 1) + (n - 1 >= 4 ? 1 : 0);
    case "series":
      // Best-of-three: 2 matches minimum, 3 worst-case.
      return 3;
    case "roundrobin":
      // Full round-robin: n choose 2.
      return (n * (n - 1)) / 2;
    default:
      return n;
  }
}

export interface AreaPlanInput {
  categoryOrder: string[];
  categories: Record<string, Category>;
  areaCount: number;
  /** Areas the operator has manually disabled — receive no new assignments. */
  disabledAreas?: number[];
}

export interface AreaPlanArea {
  /** 0-based index. */
  index: number;
  label: string;
  subcategoryIds: string[];
  load: number;
}

export interface AreaPlan {
  areas: AreaPlanArea[];
  assignments: AreaAssignments;
}

export function areaLabel(idx: number): string {
  return `Area ${idx + 1}`;
}

/**
 * Distribute a tournament's subcategories across N areas using LPT
 * (longest-processing-time first) bin-packing on estimated match count.
 *
 * Goal: minimize the wall-clock makespan — every area finishes its day
 * at roughly the same time. Counting subcategories alone misses that a
 * 16-person standard bracket has 15× the work of a 4-person playoff;
 * LPT on `estimatedMatchCount` weights each subcategory by its actual
 * throughput cost.
 *
 * Algorithm:
 *   1. Honor explicit `existing` assignments first (operator overrides).
 *   2. Sort remaining subcategories by estimatedMatchCount descending.
 *   3. For each subcategory, assign it to the area with the lowest current
 *      load (LPT — classic 4/3-OPT approximation for makespan).
 *
 * `.load` on AreaPlanArea now carries the total estimated match count,
 * not the subcategory count, so downstream UIs that read it get the
 * throughput-balanced view.
 */
export function buildAreaPlan(
  input: AreaPlanInput,
  existing: AreaAssignments = {}
): AreaPlan {
  const n = Math.max(1, Math.min(10, input.areaCount | 0));
  const disabledSet = new Set((input.disabledAreas ?? []).filter((i) => i >= 0 && i < n));
  // If every area is disabled, fall back to all enabled — refusing to
  // assign would freeze the tournament.
  const anyEnabled = disabledSet.size < n;
  const isEnabled = (idx: number) => !anyEnabled || !disabledSet.has(idx);
  const areas: AreaPlanArea[] = Array.from({ length: n }, (_, i) => ({
    index: i,
    label: areaLabel(i),
    subcategoryIds: [],
    load: 0,
  }));
  const assignments: AreaAssignments = {};

  // Honor existing manual assignments first — but skip targets that are
  // now disabled; those subcategories fall back to LPT redistribution.
  const claimed = new Set<string>();
  for (const catId of input.categoryOrder) {
    const cat = input.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      const target = existing[sub.id];
      if (typeof target === "number" && target >= 0 && target < n && isEnabled(target)) {
        const cost = estimatedMatchCount(sub);
        areas[target]!.subcategoryIds.push(sub.id);
        areas[target]!.load += cost;
        assignments[sub.id] = target;
        claimed.add(sub.id);
      }
    }
  }

  // Collect all unclaimed subcategories along with their estimated cost.
  const pending: Array<{ sub: Subcategory; cost: number }> = [];
  for (const catId of input.categoryOrder) {
    const cat = input.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      if (claimed.has(sub.id)) continue;
      pending.push({ sub, cost: estimatedMatchCount(sub) });
    }
  }
  // LPT: heaviest first. Ties broken by id for stability.
  pending.sort((a, b) => b.cost - a.cost || a.sub.id.localeCompare(b.sub.id));

  function lightestArea(): AreaPlanArea {
    const pool = areas.filter((a) => isEnabled(a.index));
    let best = pool[0]!;
    for (const a of pool) if (a.load < best.load) best = a;
    return best;
  }

  for (const { sub, cost } of pending) {
    const a = lightestArea();
    a.subcategoryIds.push(sub.id);
    a.load += cost;
    assignments[sub.id] = a.index;
  }

  return { areas, assignments };
}

export function subcategoryIdsForArea(
  state: { tournament: { categoryOrder: string[]; categories: Record<string, Category> } },
  assignments: AreaAssignments,
  areaIndex: number
): string[] {
  const out: string[] = [];
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      if (assignments[sub.id] === areaIndex) out.push(sub.id);
    }
  }
  return out;
}

/** True if a category has at least one subcategory in the given area. */
export function categoryHasArea(
  category: Category,
  assignments: AreaAssignments,
  areaIndex: number
): boolean {
  return category.subcategories.some((s) => assignments[s.id] === areaIndex);
}

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
