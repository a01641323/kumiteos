// =============================================================
// Engine types — match assignment, area runtime, delay detection.
//
// These live alongside the bracket trees (which remain authoritative for
// game state). The engine maintains a *runtime view* keyed on synthetic
// stable match IDs derived from ActiveMatchRef, plus per-area, per-
// competitor, and per-subcategory bookkeeping.
//
// All shapes are JSON-serialisable so the master state can be persisted
// to `userData/tournament-state.json` and rebuilt on server restart.
// =============================================================

import type { ActiveMatchRef, Discipline } from "./types";

export type MatchStatus =
  | "PENDING"        // both competitors not yet known, or blocked by KATA ordering
  | "READY"          // both competitors known, no winner yet, eligible for assignment
  | "IN_PROGRESS"    // assigned + startTs recorded
  | "COMPLETED";     // winner recorded

export type CompetitorStatus =
  | "AVAILABLE"
  | "IN_MATCH"
  | "RESTING"
  | "ABSENT";

export type AreaStatus = "LIBRE" | "ACTIVA" | "RETRASADA";

export type CheckInStatus = "OPEN" | "CLOSED";

export type SubcategoryFormat = "SINGLE_ELIMINATION" | "ROUND_ROBIN" | "SERIES" | "PLAYIN";

// =============================================================
// Match runtime — only the runtime extension. The bracket tree
// holds p1/p2/winner. We store start/end/area-assignment here.
// =============================================================
export interface MatchRuntime {
  /** Stable synthetic id; see `matchIdFromRef`. */
  id: string;
  ref: ActiveMatchRef;
  discipline: Discipline;
  /** Which bracket tree (relevant when subcategory is BOTH). */
  bracketTree: "KATA" | "COMBAT";
  status: MatchStatus;
  /** 0-based area index, or null if unassigned. */
  assignedAreaIndex: number | null;
  startTs: number | null;
  endTs: number | null;
  /** A BYE auto-advances and never enters the engine. */
  isBye: boolean;
}

// =============================================================
// Competitor runtime
// =============================================================
export interface CompetitorRuntime {
  /** Full name (matches the names stored in bracket trees). */
  id: string;
  status: CompetitorStatus;
  /** Unix ms of last match end (across disciplines). */
  lastMatchEndTs: number | null;
  /** 0-based area index where last seen, for adjacency scoring. */
  lastAreaIndex: number | null;
  /** 0-based area index this competitor is currently fighting in. */
  currentAreaIndex: number | null;
}

// =============================================================
// Subcategory runtime — separate from the bracket data because
// it tracks lifecycle and queueing state across the tournament.
// =============================================================
export interface SubcategoryRuntime {
  id: string;
  checkInStatus: CheckInStatus;
  /** Unix ms — when check-in closed (manual or by official start). */
  checkInClosedTs: number | null;
  /** Unix ms — scheduled start time. Drives wait-queue priority. */
  officialStartTs: number | null;
  /** Unix ms — when first match in this subcategory began. */
  actualStartTs: number | null;
  /** Unix ms — when the last match completed. */
  completedTs: number | null;
  /** Unix ms — when it entered the assignment queue. */
  waitingSince: number | null;
  /** Area indices this subcategory is currently running in. */
  assignedAreaIndices: number[];
  /** Competitor names removed at check-in close. */
  absentCompetitors: string[];
}

// =============================================================
// Area runtime
// =============================================================
export interface AreaMatchHistoryEntry {
  matchId: string;
  startTs: number;
  endTs: number;
}

export interface AreaRuntime {
  /** 0-based index in the area chain. Doubles as adjacencyIndex. */
  index: number;
  name: string;
  status: AreaStatus;
  /** Subcategory ids currently active in this area. */
  assignedSubcategories: string[];
  matchHistory: AreaMatchHistoryEntry[];
  /** Unix ms when the first match was assigned (delay calc start). */
  firstMatchAssignedTs: number | null;
  /** Cached last performanceRatio for diagnostics + UI. */
  performanceRatio: number | null;
}

// =============================================================
// Engine config — adjustable from superadmin.
// =============================================================
export interface EngineConfig {
  /** Average match duration in SECONDS — used for delay detection. */
  avgMatchDurationSeconds: number;
  /** performanceRatio threshold under which an area is RETRASADA. */
  delayThreshold: number;
  /** Hard rest constraint between consecutive matches. */
  minRestSeconds: number;
  scoreContinuityBonus: number;
  scoreDelayPenalty: number;
  scoreAdjacencyBonus: number;
  scoreCriticalPathBonus: number;
  scoreAgingBonus: number;
  scoreFreeAreaBonus: number;
  scoreRestViolationPenalty: number;
  /** Max adjacency distance when looking for interleave candidates. */
  interleaveSearchRadius: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  avgMatchDurationSeconds: 180,
  delayThreshold: 0.85,
  minRestSeconds: 120,
  scoreContinuityBonus: 60,
  scoreDelayPenalty: -50,
  scoreAdjacencyBonus: 30,
  scoreCriticalPathBonus: 20,
  scoreAgingBonus: 15,
  scoreFreeAreaBonus: 40,
  scoreRestViolationPenalty: -80,
  interleaveSearchRadius: 1,
};

// =============================================================
// nextMatchPerArea — engine output broadcast to all clients.
// =============================================================
export interface NextMatchHint {
  matchId: string;
  /** True when this match was inserted to fill a rest gap in another sub. */
  isInterleaved: boolean;
  /** When interleaving, the primary subcategory whose sequence is paused. */
  primarySubcategoryId: string | null;
}

// =============================================================
// Master engine state container (attached to AppState.engine).
// =============================================================
export interface EngineState {
  config: EngineConfig;
  areas: AreaRuntime[];
  /** matchId → runtime. */
  matches: Record<string, MatchRuntime>;
  /** competitor name → runtime. */
  competitors: Record<string, CompetitorRuntime>;
  /** subcategoryId → runtime. */
  subcategories: Record<string, SubcategoryRuntime>;
  /** areaIndex → next match hint (null = nothing scheduled). */
  nextMatchPerArea: Record<number, NextMatchHint | null>;
  /** Subcategory ids waiting for an area, ordered by priority. */
  assignmentQueue: string[];
  /** Last engine tick timestamp (Unix ms). */
  lastTickTs: number;
}
