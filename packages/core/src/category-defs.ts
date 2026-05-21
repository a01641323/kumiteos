import type { BeltColor, CategoryDef, Participant } from "./types";

export function newCategoryDefId(): string {
  return (
    "cat_" +
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-4)
  );
}

export function categoryDefMatches(def: CategoryDef, p: Participant): boolean {
  if (def.belts.length > 0 && !def.belts.includes(p.beltColor)) return false;
  if (p.age < def.minAge) return false;
  if (def.maxAge !== null && p.age > def.maxAge) return false;
  return true;
}

export function findCategoryForParticipant(
  defs: CategoryDef[],
  p: Participant
): CategoryDef | null {
  for (const def of defs) {
    if (categoryDefMatches(def, p)) return def;
  }
  return null;
}

export function describeCategoryDef(def: CategoryDef): string {
  const ageLabel = def.maxAge === null ? `${def.minAge}+` : `${def.minAge}–${def.maxAge}`;
  const beltLabel = def.belts.length === 0 ? "Any belt" : def.belts.join("/");
  return `${def.name} · ${beltLabel} · ${ageLabel}`;
}

/** Default category definitions seeded on first launch. */
export function defaultCategoryDefs(): CategoryDef[] {
  return [
    {
      id: "cat_yellow_4_6",
      name: "Yellow 4-6",
      belts: ["yellow"] as BeltColor[],
      minAge: 4,
      maxAge: 6,
    },
    {
      id: "cat_brown_10_12",
      name: "Brown 10-12",
      belts: ["brown"] as BeltColor[],
      minAge: 10,
      maxAge: 12,
    },
    {
      id: "cat_black_13_15",
      name: "Black 13-15",
      belts: ["black"] as BeltColor[],
      minAge: 13,
      maxAge: 15,
    },
    {
      id: "cat_adult_open",
      name: "Adult Open",
      belts: [] as BeltColor[], // empty = any belt
      minAge: 16,
      maxAge: null,
    },
  ];
}
