import type { AreaAssignments, Category } from "./types";

export interface AreaPlanInput {
  categoryOrder: string[];
  categories: Record<string, Category>;
  areaCount: number;
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
 * Distribute a tournament's subcategories across N areas.
 *
 * Goals (in priority order):
 *   1. Balance the total number of subcategories per area.
 *   2. Keep all subcategories of the same category together where possible
 *      (avoid splitting a category across more areas than necessary).
 *
 * Algorithm: greedy bin-packing on whole categories first, breaking up only
 * when a category alone wouldn't fit in any single area's fair share.
 *
 * If `existing` is provided, those assignments are honored as long as the
 * area indices are within range; remaining subcategories are auto-assigned.
 */
export function buildAreaPlan(
  input: AreaPlanInput,
  existing: AreaAssignments = {}
): AreaPlan {
  const n = Math.max(1, Math.min(10, input.areaCount | 0));
  const areas: AreaPlanArea[] = Array.from({ length: n }, (_, i) => ({
    index: i,
    label: areaLabel(i),
    subcategoryIds: [],
    load: 0,
  }));
  const assignments: AreaAssignments = {};

  // Honor existing manual assignments first.
  const claimed = new Set<string>();
  for (const catId of input.categoryOrder) {
    const cat = input.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      const target = existing[sub.id];
      if (typeof target === "number" && target >= 0 && target < n) {
        areas[target]!.subcategoryIds.push(sub.id);
        areas[target]!.load++;
        assignments[sub.id] = target;
        claimed.add(sub.id);
      }
    }
  }

  // Group remaining subcategories by category, ordered by descending size for
  // better bin-packing.
  type Group = { catId: string; subIds: string[] };
  const groups: Group[] = [];
  for (const catId of input.categoryOrder) {
    const cat = input.categories[catId];
    if (!cat) continue;
    const subIds = cat.subcategories
      .map((s) => s.id)
      .filter((id) => !claimed.has(id));
    if (subIds.length > 0) groups.push({ catId, subIds });
  }
  groups.sort((a, b) => b.subIds.length - a.subIds.length);

  const total = groups.reduce((acc, g) => acc + g.subIds.length, 0) +
    Object.keys(assignments).length;
  const fairShare = Math.ceil(total / n);

  function lightestArea(): AreaPlanArea {
    let best = areas[0]!;
    for (const a of areas) if (a.load < best.load) best = a;
    return best;
  }

  for (const group of groups) {
    // Try to place the entire group together if at least one area has room.
    const target = areas
      .slice()
      .sort((a, b) => a.load - b.load)
      .find((a) => a.load + group.subIds.length <= fairShare);
    if (target) {
      for (const id of group.subIds) {
        target.subcategoryIds.push(id);
        target.load++;
        assignments[id] = target.index;
      }
      continue;
    }
    // Otherwise spill into the currently-lightest areas one subcategory at a time.
    for (const id of group.subIds) {
      const a = lightestArea();
      a.subcategoryIds.push(id);
      a.load++;
      assignments[id] = a.index;
    }
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
