// Action envelope builders shared between local-apply (STANDALONE) and
// network-send (SERVER / CLIENT) paths. Keeping the schema in one place
// avoids drift between the renderer reducer and the main-process reducer
// in apps/desktop/network/actions.js.
//
// Scoreboard-touching builders all take `areaIdx` so the server reducer
// routes to the per-area state.matchesByArea[areaIdx] slot. Each console
// (admin/private screen) operates on its own scoreboard.

import type { ActiveMatchRef } from "@karate/core";
import type { NetworkActionEnvelope } from "./api-client";

function id(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Normalize: undefined or non-finite → 0 (legacy default). */
function ai(v?: number | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function scorePoint(side: "blue" | "red", n: number, areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SCORE_POINT", payload: { side, n, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function addPenalty(side: "blue" | "red", delta: number, areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "ADD_PENALTY", payload: { side, delta, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function setAdvantage(side: "blue" | "red", value: boolean, areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SET_ADVANTAGE", payload: { side, value, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function timerToggle(areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "TIMER_TOGGLE", payload: { areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function timerAdjust(delta: number, areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "TIMER_ADJUST", payload: { delta, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function resetScoreboard(areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "RESET_SCOREBOARD", payload: { areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function selectMatch(ref: ActiveMatchRef, areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SELECT_MATCH", payload: { ref, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function advanceWinner(ref?: ActiveMatchRef, areaIdx?: number | null): NetworkActionEnvelope {
  // ref tells the engine WHICH bracket match was just decided.
  // areaIdx tells it WHERE to look for the next match — and which
  // per-area scoreboard slot to roll forward.
  return {
    actionId: id(),
    actionType: "ADVANCE_WINNER",
    payload: { ref, areaIdx: ai(areaIdx) },
    ts: Date.now(),
  };
}
export function eliminate(side: "blue" | "red", ref?: ActiveMatchRef, areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "ELIMINATE", payload: { side, ref, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function setActiveCategory(catId: string): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SET_ACTIVE_CATEGORY", payload: { catId }, ts: Date.now() };
}
export function setActiveSubcategory(catId: string, subId: string): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SET_ACTIVE_SUBCATEGORY", payload: { catId, subId }, ts: Date.now() };
}
export function setActiveDiscipline(catId: string, subId: string, discipline: "combat" | "kata"): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SET_ACTIVE_DISCIPLINE", payload: { catId, subId, discipline }, ts: Date.now() };
}
export function resolveJury(chosenName: string): NetworkActionEnvelope {
  return { actionId: id(), actionType: "RESOLVE_JURY", payload: { chosenName }, ts: Date.now() };
}
export function markArrived(participantId: string, arrived: boolean): NetworkActionEnvelope {
  return { actionId: id(), actionType: "MARK_ARRIVED", payload: { participantId, arrived }, ts: Date.now() };
}
export function setKataScore(side: "blue" | "red", value: number, areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SET_KATA_SCORE", payload: { side, value, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function loadExtraMatch(discipline: "combat" | "kata", areaIdx?: number | null): NetworkActionEnvelope {
  return { actionId: id(), actionType: "LOAD_EXTRA_MATCH", payload: { discipline, areaIdx: ai(areaIdx) }, ts: Date.now() };
}
export function startCategory(catId: string): NetworkActionEnvelope {
  return { actionId: id(), actionType: "START_CATEGORY", payload: { catId }, ts: Date.now() };
}
export function setAreaDisabled(areaIndex: number, disabled: boolean): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SET_AREA_DISABLED", payload: { areaIndex, disabled }, ts: Date.now() };
}
/** Wholesale state replacement, used by complex superadmin operations. */
export function replaceState(state: unknown): NetworkActionEnvelope {
  return { actionId: id(), actionType: "REPLACE_STATE", payload: { state }, ts: Date.now() };
}

export const ACTION_IDS = { scorePoint } as const;
