export type Discipline = "combat" | "kata";
export type DisciplineMode = Discipline | "both";
export type SubcategorySize = 4 | 8 | 16 | 32;

export type SubcategoryType =
  | "standard"
  | "playin"
  | "series"
  | "roundrobin";

export type BeltColor =
  | "white"
  | "yellow"
  | "orange"
  | "green"
  | "blue"
  | "purple"
  | "brown"
  | "black";

export type AgeRange = "4-6" | "7-9" | "10-12" | "13-15" | "16-17" | "adult";

export interface Participant {
  id: string;
  nombre: string;
  apellido: string;
  /**
   * Club / dojo the competitor represents. Optional — used by the
   * dojo-aware seeder (see dojo-seeding.ts) to keep same-dojo fighters
   * apart in the brackets. Never displayed on the scoreboard / brackets.
   */
  dojo?: string;
  beltColor: BeltColor;
  age: number;
  /**
   * Whether this participant has checked in for the tournament. Set via the
   * Check-in tab on tournament day. Defaults to false on CSV import so the
   * operator must explicitly mark arrivals. Loaders from older state files
   * fill this in as `true` to keep legacy snapshots playable.
   */
  arrived?: boolean;
}

export interface MatchResultSide {
  name: string;
  points: number;
  penalties: number;
  advantage: boolean;
}
export interface MatchResult {
  p1: MatchResultSide;
  p2: MatchResultSide;
}

export interface Match {
  p1: string | null;
  p2: string | null;
  winner: string | null;
  eliminated: string | null;
  jury: boolean;
  result: MatchResult | null;
  pair?: "ab" | "ac" | "bc";
}

export interface StandardTree {
  rounds: Match[][];
  champion: string | null;
  /** Optional 3rd-place playoff between the two semifinal losers. */
  thirdPlace?: Match | null;
}
export interface PlayinTree {
  extra: Match;
  bracket: StandardTree;
}
export interface SeriesTree {
  matches: [Match, Match];
  winner: string | null;
  juryDecided: boolean;
}
export interface RRRanking {
  name: string;
  w: number;
  l: number;
  pts: number;
  pen: number;
  senshu: number;
}
export interface RRTree {
  matches: Match[];
  rankings: RRRanking[] | null;
  winner: string | null;
  juryDecided: boolean;
}

export type AnyTree = StandardTree | PlayinTree | SeriesTree | RRTree;

export interface Subcategory {
  id: string;
  categoryId: string;
  type: SubcategoryType;
  label: string;
  tag: "" | "playin" | "series" | "rr";
  competitors: string[];
  trees: Partial<Record<Discipline, AnyTree>>;
  activeDiscipline: Discipline;
}

export interface Category {
  id: string;
  name: string;
  /**
   * Primary belt color used for sorting/coloring (first allowed belt of the def, or "white" fallback).
   */
  beltColor: BeltColor;
  ageRange: AgeRange;
  competitors: string[];
  subcategories: Subcategory[];
  activeSubcategoryId: string | null;
  champion: Partial<Record<Discipline, string>>;
  /**
   * Has the operator confirmed arrivals and locked the category in?
   * Until `started === true`, brackets are NOT built and `SELECT_MATCH`
   * actions for any of this category's matches are rejected.
   */
  started?: boolean;
}

/**
 * A user-editable category definition. Acts as the matching rule used to decide
 * which Category a Participant belongs to (by belt + age range).
 *
 * `belts` is multi-select; an empty array means "any belt".
 * `maxAge: null` means "no upper bound" (i.e., adult open).
 */
export interface CategoryDef {
  id: string;
  name: string;
  belts: BeltColor[];
  minAge: number;
  maxAge: number | null;
  /**
   * Match (combat) duration in SECONDS for this category. Optional —
   * when unset, matches use the tournament-wide default
   * (`settings.defaultDuration`, 120s = 2:00). Lets organizers give,
   * e.g., younger categories shorter bouts.
   */
  matchDurationSeconds?: number;
}

export interface TournamentSettings {
  subcategorySize: SubcategorySize;
  disciplineMode: DisciplineMode;
  /** Number of physical competition areas (1-10). */
  areaCount: number;
  /** Auto-finish a combat match when one side leads by this many points (0 = disabled). */
  pointDifference?: number;
  /**
   * Optional venue layout: for each area index, neighbor indices ranked
   * nearest-first. When unset, neighbors default to a linear chain (|i-j|).
   */
  areaAdjacency?: number[][];
}

export interface MatchPathStd {
  kind: "std";
  round: number;
  idx: number;
}
export interface MatchPathPlayin {
  kind: "playin";
}
export interface MatchPathSeries {
  kind: "series";
  idx: number;
}
export interface MatchPathRR {
  kind: "rr";
  pair: "ab" | "ac" | "bc";
}
export interface MatchPathThird {
  kind: "3rd";
}
export type MatchPath =
  | MatchPathStd
  | MatchPathPlayin
  | MatchPathSeries
  | MatchPathRR
  | MatchPathThird;

export interface ActiveMatchRef {
  categoryId: string;
  subcategoryId: string;
  discipline: Discipline;
  path: MatchPath;
}

export interface MatchState {
  blueName: string;
  redName: string;
  bluePoints: number;
  redPoints: number;
  /**
   * Per-value counters used as the second-level tiebreak when points are
   * tied and neither side holds the lone advantage. Más ippon → más
   * wasari → más yuko → jury. Updated by the SCORE_POINT reducer on
   * every delta so undo (negative deltas) keeps them honest.
   */
  blueIppon: number; // 3-point scores
  redIppon: number;
  blueWasari: number; // 2-point scores
  redWasari: number;
  blueYuko: number; // 1-point scores
  redYuko: number;
  bluePenalties: number;
  redPenalties: number;
  blueAdvantage: boolean;
  redAdvantage: boolean;
  blueEliminated: boolean;
  redEliminated: boolean;
  discipline: Discipline | null;
  activeMatchRef: ActiveMatchRef | null;
  /**
   * Briefly-flashed reason the most recent winner was declared via the
   * point-type tiebreak. Cleared when the next match loads.
   */
  tieBreakReason?: "ippon" | "wasari" | "yuko" | null;
}

export interface TimerState {
  duration: number;
  remaining: number;
  running: boolean;
  finished: boolean;
  /**
   * Server-authoritative transition markers. Set by the network controller's
   * timer tick (or by the standalone tick in `apps/web/lib/store.tsx`) when
   * the 15-second warning and end-of-time events fire. Renderers watch for
   * value changes on these to play their local beeps without running their
   * own countdown.
   */
  warnedAt?: number;
  expiredAt?: number;
}

export type CommandKey =
  | "selectRed"
  | "selectBlue"
  | "add1"
  | "add2"
  | "add3"
  | "senshu"
  | "penalty"
  | "undo"
  | "pauseTimer"
  | "addSecond"
  | "subSecond";

export interface AppSettings {
  defaultDuration: number;
  keys: Record<CommandKey, string>;
}

export interface JuryContextMatch {
  kind: "match";
  ref: ActiveMatchRef;
}
export interface JuryContextSeries {
  kind: "series-final";
  subRef: { categoryId: string; subcategoryId: string; discipline: Discipline };
}
export interface JuryContextRR {
  kind: "rr-final";
  subRef: { categoryId: string; subcategoryId: string; discipline: Discipline };
}
export type JuryContext =
  | JuryContextMatch
  | JuryContextSeries
  | JuryContextRR;

export interface JuryState {
  competitors: [string, string];
  context: JuryContext;
}

/**
 * Maps each subcategory id to its assigned area index (0-based).
 * Subcategories with no entry are unassigned (visible only to superadmin).
 */
export type AreaAssignments = Record<string, number>;

export interface TournamentMeta {
  /** Random seed used for the latest seeding pass (Mulberry32). */
  seed: number;
  /** Logo URL the app should display (server-relative or absolute). null = no logo. */
  logoUrl: string | null;
}

export interface AppState {
  tournament: {
    settings: TournamentSettings;
    categoryDefs: CategoryDef[];
    participants: Participant[];
    categories: Record<string, Category>;
    categoryOrder: string[];
    activeCategoryId: string | null;
    areaAssignments: AreaAssignments;
    /**
     * Area indices currently DISABLED by the operator. Disabled areas
     * are skipped by buildAreaPlan and runEngineTick — no new matches
     * are routed to them until re-enabled. Empty / missing = all areas
     * active. Legacy snapshots may lack this field.
     */
    disabledAreas?: number[];
    meta: TournamentMeta;
  };
  match: MatchState;
  timer: TimerState;
  settings: AppSettings;
  jury: JuryState | null;
  /**
   * Match-assignment engine runtime view. Hydrated lazily by the engine on
   * the server; safe to be `undefined` on older persisted states (the engine
   * rebuilds from the bracket on first tick after load).
   */
  engine?: import("./engine-types").EngineState;
  /**
   * Short-lived UI flash. Currently only used to surface "Más ippon /
   * wasari / yuko" after a tied combat match auto-advances. The renderer
   * clears it after ~3 s (or on next match load) so it never persists.
   */
  flash?: {
    kind: "tiebreak";
    reason: "ippon" | "wasari" | "yuko";
    winnerName: string;
    expiresAtMs: number;
  } | null;
}
