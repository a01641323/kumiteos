import type {
  Match,
  Subcategory,
  SubcategoryType,
  SubcategorySize,
  DisciplineMode,
  Discipline,
  AnyTree,
  StandardTree,
  PlayinTree,
  SeriesTree,
  RRTree,
  Category,
  TournamentSettings,
} from "./types";

export function emptyMatch(p1: string | null, p2: string | null): Match {
  return {
    p1: p1 ?? null,
    p2: p2 ?? null,
    winner: null,
    eliminated: null,
    jury: false,
    result: null,
  };
}

export interface SubSpec {
  type: SubcategoryType | "playin-orphan";
  size?: SubcategorySize | 4 | 8 | 16;
  competitors: (string | null)[];
  playinCompetitors?: [string, string];
  fullCompetitorList?: string[];
}

export function distributeRemainder(comps: string[]): SubSpec[] {
  const R = comps.length;
  if (R === 0) return [];
  if (R === 1) return [{ type: "playin-orphan", competitors: comps.slice() }];
  if (R === 2) return [{ type: "series", competitors: comps.slice() }];
  if (R === 3) return [{ type: "roundrobin", competitors: comps.slice() }];
  if (R === 4) return [{ type: "standard", size: 4, competitors: comps.slice() }];
  if (R < 8)
    return [
      { type: "standard", size: 4, competitors: comps.slice(0, 4) },
      ...distributeRemainder(comps.slice(4)),
    ];
  if (R === 8) return [{ type: "standard", size: 8, competitors: comps.slice() }];
  return [
    { type: "standard", size: 8, competitors: comps.slice(0, 8) },
    ...distributeRemainder(comps.slice(8)),
  ];
}

/**
 * Merge any cascaded R=1 leftover (a "playin-orphan") into the prior
 * standard subcategory by converting it to a play-in variant.
 */
export function consolidatePlayinOrphans(specs: SubSpec[]): SubSpec[] {
  const out: SubSpec[] = [];
  for (const s of specs) {
    const prev = out[out.length - 1];
    if (s.type === "playin-orphan" && prev && prev.type === "standard") {
      const promoted = prev.competitors[prev.competitors.length - 1] as string;
      const leftover = s.competitors[0] as string;
      out[out.length - 1] = {
        type: "playin",
        size: prev.size,
        competitors: prev.competitors.slice(0, -1).concat([null]),
        playinCompetitors: [promoted, leftover],
        fullCompetitorList: (prev.competitors as string[]).concat([leftover]),
      };
    } else {
      out.push(s);
    }
  }
  return out;
}

export function buildSubcategorySpecs(
  competitors: string[],
  G: SubcategorySize
): SubSpec[] {
  const N = competitors.length;
  const fullGroups = Math.floor(N / G);
  const R = N % G;
  const specs: SubSpec[] = [];

  if (R === 1 && fullGroups >= 1) {
    for (let i = 0; i < fullGroups - 1; i++) {
      specs.push({
        type: "standard",
        size: G,
        competitors: competitors.slice(i * G, (i + 1) * G),
      });
    }
    const lastGroup = competitors.slice(
      (fullGroups - 1) * G,
      fullGroups * G
    );
    const promoted = lastGroup[lastGroup.length - 1];
    const leftover = competitors[fullGroups * G];
    specs.push({
      type: "playin",
      size: G,
      competitors: [...lastGroup.slice(0, -1), null],
      playinCompetitors: [promoted, leftover],
      fullCompetitorList: lastGroup.concat([leftover]),
    });
    return specs;
  }

  for (let i = 0; i < fullGroups; i++) {
    specs.push({
      type: "standard",
      size: G,
      competitors: competitors.slice(i * G, (i + 1) * G),
    });
  }

  if (R === 0) return specs;

  const leftover = competitors.slice(fullGroups * G);
  specs.push(...distributeRemainder(leftover));
  return consolidatePlayinOrphans(specs);
}

export function buildStandardTree(competitors: (string | null)[]): StandardTree {
  const G = competitors.length;
  const rounds: Match[][] = [];
  const r0: Match[] = [];
  for (let i = 0; i < G; i += 2) {
    r0.push(emptyMatch(competitors[i] ?? null, competitors[i + 1] ?? null));
  }
  rounds.push(r0);
  let prev = r0;
  while (prev.length > 1) {
    const next: Match[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(emptyMatch(null, null));
    }
    rounds.push(next);
    prev = next;
  }
  return { rounds, champion: null };
}

export function buildSeriesTree(competitors: string[]): SeriesTree {
  return {
    matches: [
      emptyMatch(competitors[0], competitors[1]),
      emptyMatch(competitors[0], competitors[1]),
    ],
    winner: null,
    juryDecided: false,
  };
}

export function buildRRTree(competitors: string[]): RRTree {
  const [a, b, c] = competitors;
  return {
    matches: [
      Object.assign(emptyMatch(a, b), { pair: "ab" as const }),
      Object.assign(emptyMatch(a, c), { pair: "ac" as const }),
      Object.assign(emptyMatch(b, c), { pair: "bc" as const }),
    ],
    rankings: null,
    winner: null,
    juryDecided: false,
  };
}

export function buildPlayinTree(spec: SubSpec): PlayinTree {
  const [p1, p2] = spec.playinCompetitors!;
  return {
    extra: emptyMatch(p1, p2),
    bracket: buildStandardTree(spec.competitors),
  };
}

export function buildTreeFromSpec(spec: SubSpec): AnyTree {
  if (spec.type === "standard") return buildStandardTree(spec.competitors);
  if (spec.type === "playin") return buildPlayinTree(spec);
  if (spec.type === "series")
    return buildSeriesTree(spec.competitors as string[]);
  if (spec.type === "roundrobin")
    return buildRRTree(spec.competitors as string[]);
  // Defensive: orphans should never reach here after consolidation.
  return buildStandardTree(spec.competitors);
}

export function buildSubcategory(
  spec: SubSpec,
  idx: number,
  catId: string,
  mode: DisciplineMode
): Subcategory {
  const id = `${catId}-sub-${idx + 1}`;
  let label: string;
  let tag: Subcategory["tag"];
  if (spec.type === "standard") {
    label = `Group ${idx + 1}`;
    tag = "";
  } else if (spec.type === "playin") {
    label = `Group ${idx + 1} · Play-in`;
    tag = "playin";
  } else if (spec.type === "series") {
    label = "2-Match Series";
    tag = "series";
  } else if (spec.type === "roundrobin") {
    label = "Round Robin";
    tag = "rr";
  } else {
    label = "Group";
    tag = "";
  }

  const competitors =
    spec.fullCompetitorList ?? spec.competitors.filter(Boolean) as string[];

  const trees: Subcategory["trees"] = {};
  const disciplines: Discipline[] =
    mode === "both" ? ["combat", "kata"] : [mode];
  for (const disc of disciplines) {
    trees[disc] = buildTreeFromSpec(spec);
  }

  return {
    id,
    categoryId: catId,
    type: spec.type as SubcategoryType,
    label,
    tag,
    competitors,
    trees,
    activeDiscipline: disciplines[0],
  };
}

export function rebuildCategorySubcategories(
  cat: Category,
  settings: TournamentSettings
): void {
  const specs = buildSubcategorySpecs(cat.competitors, settings.subcategorySize);
  cat.subcategories = specs.map((spec, idx) =>
    buildSubcategory(spec, idx, cat.id, settings.disciplineMode)
  );
  cat.activeSubcategoryId = cat.subcategories[0]?.id ?? null;
  cat.champion = {};
}
