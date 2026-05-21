// Action envelope builders shared between local-apply (STANDALONE) and
// network-send (SERVER / CLIENT) paths. Keeping the schema in one place
// avoids drift between the renderer reducer and the main-process reducer
// in apps/desktop/network/actions.js.

import type { ActiveMatchRef } from "@karate/core";
import type { NetworkActionEnvelope } from "./api-client";

function id(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function scorePoint(side: "blue" | "red", n: number): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SCORE_POINT", payload: { side, n }, ts: Date.now() };
}
export function addPenalty(side: "blue" | "red", delta: number): NetworkActionEnvelope {
  return { actionId: id(), actionType: "ADD_PENALTY", payload: { side, delta }, ts: Date.now() };
}
export function setAdvantage(side: "blue" | "red", value: boolean): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SET_ADVANTAGE", payload: { side, value }, ts: Date.now() };
}
export function timerToggle(): NetworkActionEnvelope {
  return { actionId: id(), actionType: "TIMER_TOGGLE", payload: {}, ts: Date.now() };
}
export function timerAdjust(delta: number): NetworkActionEnvelope {
  return { actionId: id(), actionType: "TIMER_ADJUST", payload: { delta }, ts: Date.now() };
}
export function resetScoreboard(): NetworkActionEnvelope {
  return { actionId: id(), actionType: "RESET_SCOREBOARD", payload: {}, ts: Date.now() };
}
export function selectMatch(ref: ActiveMatchRef): NetworkActionEnvelope {
  return { actionId: id(), actionType: "SELECT_MATCH", payload: { ref }, ts: Date.now() };
}
export function advanceWinner(ref?: ActiveMatchRef): NetworkActionEnvelope {
  // ref is included so machines with local-only match selection can drive
  // bracket advancement on the correct match without first broadcasting a
  // SELECT_MATCH (which would clobber other machines' loaded matches).
  return { actionId: id(), actionType: "ADVANCE_WINNER", payload: { ref }, ts: Date.now() };
}
export function eliminate(side: "blue" | "red", ref?: ActiveMatchRef): NetworkActionEnvelope {
  return { actionId: id(), actionType: "ELIMINATE", payload: { side, ref }, ts: Date.now() };
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
/** Wholesale state replacement, used by complex superadmin operations. */
export function replaceState(state: unknown): NetworkActionEnvelope {
  return { actionId: id(), actionType: "REPLACE_STATE", payload: { state }, ts: Date.now() };
}

export const ACTION_IDS = { scorePoint } as const;
