// Server-side action reducer. Each ACTION received from a client is
// validated and applied here on the authoritative master state.

import * as core from "@karate/core";

export class ActionRejectedError extends Error {
  reason: string;
  constructor(reason: string, message?: string) {
    super(message || reason);
    this.reason = reason;
  }
}

type AnyState = any;
type Handler = (s: AnyState, payload: any) => AnyState | void;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function checkCombatWin(s: AnyState) {
  const ref = s.match.activeMatchRef;
  if (!ref) return;
  const threshold = s.tournament.settings.pointDifference ?? 0;
  if (s.match.discipline === "combat" && threshold > 0) {
    const winnerSide = (core as any).computeCombatWinner(s.match, threshold);
    if (winnerSide) {
      s.timer.running = false;
      const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
      const loserName = winnerSide === "blue" ? s.match.redName : s.match.blueName;
      (core as any).finalizeMatchByRef(s, ref, winnerName, loserName, false);
      const next = (core as any).findNextMatch(s, ref);
      if (next) (core as any).loadMatchToScoreboardImpl(s, next);
    }
  }
}

const handlers: Record<string, Handler> = {
  SCORE_POINT(s, { side, n }) {
    if (side !== "blue" && side !== "red") throw new ActionRejectedError("invalid", "bad side");
    if (typeof n !== "number" || !Number.isFinite(n)) throw new ActionRejectedError("invalid", "bad n");
    const key = side === "blue" ? "bluePoints" : "redPoints";
    s.match[key] = Math.max(0, s.match[key] + n);
    checkCombatWin(s);
  },
  ADD_PENALTY(s, { side, delta }) {
    const key = side === "blue" ? "bluePenalties" : "redPenalties";
    s.match[key] = clamp(s.match[key] + delta, 0, 5);
    if (s.match[key] === 5 && delta > 0) s.timer.running = false;
  },
  SET_ADVANTAGE(s, { side, value }) {
    if (side === "blue") s.match.blueAdvantage = !!value;
    else s.match.redAdvantage = !!value;
  },
  TIMER_TOGGLE(s) {
    if (s.timer.remaining <= 0) return;
    s.timer.running = !s.timer.running;
    if (s.timer.running) s.timer.finished = false;
  },
  TIMER_ADJUST(s, { delta }) {
    s.timer.remaining = Math.max(0, s.timer.remaining + delta);
    if (s.timer.remaining > 0) s.timer.finished = false;
  },
  RESET_SCOREBOARD(s) {
    (core as any).resetLiveScoreboard(s);
  },
  SELECT_MATCH(s, { ref }) {
    if (!ref) throw new ActionRejectedError("invalid", "missing ref");
    (core as any).loadMatchToScoreboardImpl(s, ref);
  },
  ADVANCE_WINNER(s, payload) {
    const ref = (payload && payload.ref) || s.match.activeMatchRef;
    if (!ref) return;
    if (!s.match.activeMatchRef || (core as any).matchIdFromRef(s.match.activeMatchRef) !== (core as any).matchIdFromRef(ref)) {
      (core as any).loadMatchToScoreboardImpl(s, ref);
    }
    const m = (core as any).getMatchByRef(s, ref);
    if (!m || m.winner) return;
    s.match.discipline = ref.discipline;
    const threshold = s.tournament.settings.pointDifference ?? 0;
    const winnerSide = (core as any).computeWinner(s.match, threshold > 0 ? threshold : undefined);
    if (!winnerSide) {
      s.jury = { competitors: [s.match.blueName, s.match.redName], context: { kind: "match", ref } };
      return;
    }
    const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
    const loserName = winnerSide === "blue" ? s.match.redName : s.match.blueName;
    (core as any).finalizeMatchByRef(s, ref, winnerName, loserName, false);
    const next = (core as any).findNextMatch(s, ref);
    if (next) (core as any).loadMatchToScoreboardImpl(s, next);
  },
  ELIMINATE(s, { side, ref: refArg }) {
    if (side === "blue") s.match.blueEliminated = true;
    else s.match.redEliminated = true;
    s.timer.running = false;
    const ref = refArg || s.match.activeMatchRef;
    if (!ref) return;
    if (!s.match.activeMatchRef || (core as any).matchIdFromRef(s.match.activeMatchRef) !== (core as any).matchIdFromRef(ref)) {
      (core as any).loadMatchToScoreboardImpl(s, ref);
      if (side === "blue") s.match.blueEliminated = true;
      else s.match.redEliminated = true;
    }
    s.match.discipline = ref.discipline;
    const threshold = s.tournament.settings.pointDifference ?? 0;
    const winnerSide = (core as any).computeWinner(s.match, threshold > 0 ? threshold : undefined);
    if (!winnerSide) {
      s.jury = { competitors: [s.match.blueName, s.match.redName], context: { kind: "match", ref } };
      return;
    }
    const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
    const loserName = winnerSide === "blue" ? s.match.redName : s.match.blueName;
    (core as any).finalizeMatchByRef(s, ref, winnerName, loserName, false);
    const next = (core as any).findNextMatch(s, ref);
    if (next) (core as any).loadMatchToScoreboardImpl(s, next);
  },
  SET_ACTIVE_CATEGORY(s, { catId }) {
    s.tournament.activeCategoryId = catId;
  },
  SET_ACTIVE_SUBCATEGORY(s, { catId, subId }) {
    const cat = s.tournament.categories[catId];
    if (cat) cat.activeSubcategoryId = subId;
  },
  SET_ACTIVE_DISCIPLINE(s, { catId, subId, discipline }) {
    const sub = (core as any).getSubcategory(s, catId, subId);
    if (sub) sub.activeDiscipline = discipline;
  },
  RESOLVE_JURY(s, { chosenName }) {
    if (!s.jury) return;
    const j = s.jury;
    const other = j.competitors[0] === chosenName ? j.competitors[1] : j.competitors[0];
    const ctx = j.context;
    let searchFromRef: any = null;
    if (ctx.kind === "match") {
      searchFromRef = ctx.ref;
      (core as any).finalizeMatchByRef(s, ctx.ref, chosenName, other, true);
    } else if (ctx.kind === "series-final") {
      const sub = (core as any).getSubcategory(s, ctx.subRef.categoryId, ctx.subRef.subcategoryId);
      if (sub) {
        const tree = sub.trees[ctx.subRef.discipline];
        tree.winner = chosenName;
        tree.juryDecided = true;
      }
      searchFromRef = { ...ctx.subRef, path: { kind: "series", idx: 1 } };
    } else if (ctx.kind === "rr-final") {
      const sub = (core as any).getSubcategory(s, ctx.subRef.categoryId, ctx.subRef.subcategoryId);
      if (sub) {
        const tree = sub.trees[ctx.subRef.discipline];
        tree.winner = chosenName;
        tree.juryDecided = true;
      }
      searchFromRef = { ...ctx.subRef, path: { kind: "rr", pair: "bc" } };
    }
    s.jury = null;
    if (searchFromRef) {
      const next = (core as any).findNextMatch(s, searchFromRef);
      if (next) (core as any).loadMatchToScoreboardImpl(s, next);
    }
  },
  REPLACE_STATE(_s, { state }) {
    if (!state || typeof state !== "object") {
      throw new ActionRejectedError("invalid", "missing state");
    }
    return state;
  },
};

export function applyAction(state: AnyState, action: any): AnyState | null {
  const fn = handlers[action.actionType];
  if (!fn) throw new ActionRejectedError("invalid", `unknown action ${action.actionType}`);
  const result = fn(state, action.payload || {});
  return result === undefined ? null : result;
}
