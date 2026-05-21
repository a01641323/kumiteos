import type {
  AgeRange,
  BeltColor,
  Category,
  CategoryDef,
  Participant,
  TournamentSettings,
} from "./types";
import { AGE_RANGES, BELT_LABEL_EN, BELT_ORDER } from "./data";
import { rebuildCategorySubcategories } from "./subcategories";
import { findCategoryForParticipant } from "./category-defs";
import { shuffleSeeded } from "./seeding";

// =============================================================
// Legacy helpers — still used by data/csv consumers expecting derived
// (belt × age range) ids and labels. New code should prefer CategoryDef.
// =============================================================
export function ageRangeFor(age: number): AgeRange {
  if (age <= 6) return "4-6";
  if (age <= 9) return "7-9";
  if (age <= 12) return "10-12";
  if (age <= 15) return "13-15";
  if (age <= 17) return "16-17";
  return "adult";
}

export function categoryIdFor(belt: BeltColor, ar: AgeRange): string {
  return `${belt}-${ar}`;
}

export function categoryNameFor(belt: BeltColor, ar: AgeRange): string {
  const beltLabel = BELT_LABEL_EN[belt];
  if (ar === "adult") return `${beltLabel} Adult`;
  return `${beltLabel} ${ar}`;
}

export function fullName(p: Participant): string {
  return `${p.nombre} ${p.apellido}`.trim();
}

function primaryBelt(def: CategoryDef): BeltColor {
  return def.belts[0] ?? "white";
}

function ageRangeFromDef(def: CategoryDef): AgeRange {
  // For sorting / display only — pick the closest legacy bucket.
  if (def.maxAge === null) return "adult";
  return ageRangeFor(def.maxAge);
}

/**
 * Group participants into categories using the explicit CategoryDef list and
 * rebuild the subcategories of each according to the tournament settings.
 *
 * Participants that don't match any def are dropped from bracket generation
 * but kept in `tournament.participants` so the user can see them as
 * "unassigned" and adjust either the participant or the definitions.
 */
export interface RebuildOptions {
  seed: number;
  prevActiveCategoryId?: string | null;
}

export function rebuildCategoriesFromParticipants(
  participants: Participant[],
  settings: TournamentSettings,
  defs: CategoryDef[],
  opts: RebuildOptions
): {
  categories: Record<string, Category>;
  categoryOrder: string[];
  activeCategoryId: string | null;
  unassigned: Participant[];
} {
  const buckets = new Map<string, Participant[]>();
  const unassigned: Participant[] = [];

  for (const p of participants) {
    const def = findCategoryForParticipant(defs, p);
    if (!def) {
      unassigned.push(p);
      continue;
    }
    const arr = buckets.get(def.id);
    if (arr) arr.push(p);
    else buckets.set(def.id, [p]);
  }

  const categories: Record<string, Category> = {};
  const orderedDefs = defs.slice();

  for (const def of orderedDefs) {
    const bucket = buckets.get(def.id);
    if (!bucket || bucket.length === 0) continue;
    const seeded = shuffleSeeded(bucket, opts.seed ^ hashString(def.id));
    const cat: Category = {
      id: def.id,
      name: def.name,
      beltColor: primaryBelt(def),
      ageRange: ageRangeFromDef(def),
      competitors: seeded.map(fullName),
      subcategories: [],
      activeSubcategoryId: null,
      champion: {},
    };
    rebuildCategorySubcategories(cat, settings);
    categories[def.id] = cat;
  }

  const orderedDefIds = orderedDefs.filter((d) => categories[d.id]).map((d) => d.id);

  // Sort definitions: explicit user order is the primary key. We trust the
  // user's ordering of `defs`. (UIs that want a sorted view can re-sort.)
  const categoryOrder = orderedDefIds;

  const prev = opts.prevActiveCategoryId ?? null;
  const activeCategoryId =
    prev && categories[prev] ? prev : categoryOrder[0] ?? null;

  return { categories, categoryOrder, activeCategoryId, unassigned };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Sort definitions by traditional belt rank then by min age — used as the
 * default order when seeding new tournaments.
 */
export function sortDefaultDefs(defs: CategoryDef[]): CategoryDef[] {
  return defs.slice().sort((a, b) => {
    const ba = BELT_ORDER.indexOf(primaryBelt(a));
    const bb = BELT_ORDER.indexOf(primaryBelt(b));
    if (ba !== bb) return ba - bb;
    if (a.minAge !== b.minAge) return a.minAge - b.minAge;
    return a.name.localeCompare(b.name);
  });
}

