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

// Per-area scoreboard slot. Lazily initialized from the legacy global
// state.match / state.timer so existing snapshots keep working. Each
// console (area) gets its own scoreboard.
function getAreaSlot(s: AnyState, areaIdx: number): { match: any; timer: any } {
  if (!s.matchesByArea) s.matchesByArea = {};
  if (!s.timersByArea) s.timersByArea = {};
  if (!s.matchesByArea[areaIdx]) {
    s.matchesByArea[areaIdx] = JSON.parse(JSON.stringify(s.match));
  }
  if (!s.timersByArea[areaIdx]) {
    s.timersByArea[areaIdx] = JSON.parse(JSON.stringify(s.timer));
  }
  return { match: s.matchesByArea[areaIdx], timer: s.timersByArea[areaIdx] };
}

// Run a handler body with s.match / s.timer redirected to the area's
// own slot. After the body runs, the slot is updated and (for area 0)
// the legacy state.match / state.timer are mirrored.
function withArea(s: AnyState, areaIdx: number, fn: () => void): void {
  const idx = typeof areaIdx === "number" && areaIdx >= 0 ? areaIdx : 0;
  const slot = getAreaSlot(s, idx);
  const savedMatch = s.match;
  const savedTimer = s.timer;
  s.match = slot.match;
  s.timer = slot.timer;
  try { fn(); } finally {
    s.matchesByArea[idx] = s.match;
    s.timersByArea[idx] = s.timer;
    // Restore the legacy top-level pointers. Area 0 mirrors back so
    // any reader (engine ticks, /public scoreboard fallback, persisted
    // snapshot) still sees something sensible.
    if (idx === 0) {
      // legacy pointers stay in sync with area 0
      s.match = s.matchesByArea[0];
      s.timer = s.timersByArea[0];
    } else {
      s.match = savedMatch;
      s.timer = savedTimer;
    }
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function checkCombatWin(s: AnyState) {
  const ref = s.match.activeMatchRef;
  if (!ref) return;
  const threshold = s.tournament.settings.pointDifference ?? 0;
  if (s.match.discipline !== "combat" || threshold <= 0) return;
  // Only the EXPLICIT threshold triggers an auto-finalise here. The
  // "higher points wins" fallback (inside computeCombatWinner) is the
  // tie-break used at end-of-time / manual advance — applying it on
  // every SCORE_POINT would auto-end a match on a single yuko, which
  // the operator never wants.
  const diff = s.match.bluePoints - s.match.redPoints;
  const winnerSide: "blue" | "red" | null =
    diff >=  threshold ? "blue" :
    -diff >= threshold ? "red"  :
    null;
  if (!winnerSide) return;

  // Threshold hit: stop the clock, mark the bracket winner so the
  // bracket is consistent — but DO NOT load the next match. The
  // scoreboard stays on the just-finished match until the operator
  // explicitly presses Enter / Advance. That gives them a beat to
  // review the result on the public display, announce, etc.
  s.timer.running = false;
  s.timer.finished = true;
  const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
  const loserName  = winnerSide === "blue" ? s.match.redName  : s.match.blueName;
  (core as any).finalizeMatchByRef(s, ref, winnerName, loserName, false);
}

const handlers: Record<string, Handler> = {
  SCORE_POINT(s, { side, n }) {
    if (side !== "blue" && side !== "red") throw new ActionRejectedError("invalid", "bad side");
    if (typeof n !== "number" || !Number.isFinite(n)) throw new ActionRejectedError("invalid", "bad n");
    const ptKey = side === "blue" ? "bluePoints" : "redPoints";
    s.match[ptKey] = Math.max(0, s.match[ptKey] + n);
    // Track per-value counters for the ippon/wasari/yuko tiebreak. Undo
    // (negative n) walks the SAME bucket back so the counts stay honest.
    const magnitude = Math.abs(n);
    if (magnitude === 1 || magnitude === 2 || magnitude === 3) {
      const bucket =
        magnitude === 3
          ? side === "blue" ? "blueIppon"  : "redIppon"
          : magnitude === 2
          ? side === "blue" ? "blueWasari" : "redWasari"
          : side === "blue" ? "blueYuko"   : "redYuko";
      const next = (s.match[bucket] ?? 0) + Math.sign(n);
      s.match[bucket] = Math.max(0, next);
    }
    checkCombatWin(s);
  },
  ADD_PENALTY(s, { side, delta }) {
    const key = side === "blue" ? "bluePenalties" : "redPenalties";
    s.match[key] = clamp(s.match[key] + delta, 0, 5);
    if (s.match[key] === 5 && delta > 0) {
      // 5 penalties = hansoku (disqualification). Freeze the clock and
      // declare the bracket winner so the bracket is consistent — but
      // leave the scoreboard on this match until the operator hits
      // Enter / Advance, so the call can be reviewed.
      s.timer.running = false;
      s.timer.finished = true;
      const ref = s.match.activeMatchRef;
      if (ref) {
        const winnerName = side === "blue" ? s.match.redName : s.match.blueName;
        const loserName  = side === "blue" ? s.match.blueName : s.match.redName;
        if (winnerName) {
          (core as any).finalizeMatchByRef(s, ref, winnerName, loserName, false);
        }
      }
    }
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
  LOAD_EXTRA_MATCH(s, { discipline }) {
    // Training / sparring mode: load a blank match with no bracket
    // linkage. The current match's progress is discarded; the operator
    // gets a clean scoreboard they can score on without affecting the
    // tournament. Names default to placeholders so the UI doesn't
    // look empty.
    if (discipline !== "combat" && discipline !== "kata") {
      throw new ActionRejectedError("invalid", "bad discipline");
    }
    (core as any).resetLiveScoreboard(s);
    s.match.blueName = "Atleta A";
    s.match.redName  = "Atleta B";
    s.match.discipline = discipline;
    s.match.activeMatchRef = null; // no bracket linkage
    // Set the timer to the default so combat mode has something to run.
    s.timer.duration = s.settings.defaultDuration;
    s.timer.remaining = s.settings.defaultDuration;
    s.timer.running = false;
    s.timer.finished = false;
  },
  SELECT_MATCH(s, { ref }) {
    if (!ref) throw new ActionRejectedError("invalid", "missing ref");
    const cat = s.tournament.categories[ref.categoryId];
    if (cat && cat.started === false) {
      throw new ActionRejectedError(
        "category_not_started",
        "Category has not been started yet. Confirm arrivals from the Check-in tab first.",
      );
    }
    // Lock-when-playing: refuse to load a different match if there's an
    // in-progress one on the scoreboard (scoring activity AND no winner
    // declared yet AND timer not finished). Re-selecting the SAME match
    // is allowed (idempotent re-load).
    const active = s.match.activeMatchRef;
    if (active) {
      const sameMatch = (core as any).matchIdFromRef(active) === (core as any).matchIdFromRef(ref);
      if (!sameMatch) {
        const activeMatch = (core as any).getMatchByRef(s, active);
        // Only the SCOREBOARD progress locks; a running timer alone
        // doesn't (the operator may have started the clock then chosen
        // to switch to a different match before any scoring happened).
        const hasScoring =
          s.match.bluePoints > 0 ||
          s.match.redPoints > 0 ||
          s.match.bluePenalties > 0 ||
          s.match.redPenalties > 0 ||
          s.match.blueAdvantage ||
          s.match.redAdvantage;
        const matchOver =
          !!activeMatch?.winner ||
          s.timer.finished ||
          s.timer.remaining === 0 ||
          s.match.bluePenalties >= 5 ||
          s.match.redPenalties >= 5 ||
          s.match.blueEliminated ||
          s.match.redEliminated;
        if (hasScoring && !matchOver) {
          throw new ActionRejectedError(
            "match_in_progress",
            "Another match is being played right now. Finish it (or advance / eliminate) before loading a new one.",
          );
        }
      }
    }
    (core as any).loadMatchToScoreboardImpl(s, ref);
  },
  MARK_ARRIVED(s, { participantId, arrived }) {
    if (typeof participantId !== "string") {
      throw new ActionRejectedError("invalid", "missing participantId");
    }
    const ok = (core as any).markParticipantArrived(s, participantId, !!arrived);
    if (!ok) throw new ActionRejectedError("invalid", "participant not found");
  },
  SET_AREA_DISABLED(s, { areaIndex, disabled }) {
    if (typeof areaIndex !== "number" || areaIndex < 0) {
      throw new ActionRejectedError("invalid", "bad areaIndex");
    }
    const n = s.tournament.settings.areaCount ?? 1;
    if (areaIndex >= n) throw new ActionRejectedError("invalid", "areaIndex out of range");
    const cur = new Set<number>(s.tournament.disabledAreas ?? []);
    if (disabled) cur.add(areaIndex); else cur.delete(areaIndex);
    // Refuse to disable the last enabled area — would freeze the tournament.
    if (cur.size >= n) throw new ActionRejectedError("invalid", "cannot disable every area");
    s.tournament.disabledAreas = [...cur].sort((a, b) => a - b);
    // Redistribute: rebuild assignments so subcategories pinned to a
    // newly-disabled area get re-bin-packed onto the survivors.
    if (disabled) {
      const keepAssignments: any = {};
      for (const [subId, ai] of Object.entries(s.tournament.areaAssignments ?? {})) {
        if (typeof ai === "number" && ai !== areaIndex) keepAssignments[subId] = ai;
      }
      s.tournament.areaAssignments = (core as any).buildAreaPlan(
        {
          categoryOrder: s.tournament.categoryOrder,
          categories: s.tournament.categories,
          areaCount: n,
          disabledAreas: s.tournament.disabledAreas,
        },
        keepAssignments,
      ).assignments;
    }
  },
  START_CATEGORY(s, { catId }) {
    if (typeof catId !== "string") {
      throw new ActionRejectedError("invalid", "missing catId");
    }
    const cat = s.tournament.categories[catId];
    if (!cat) throw new ActionRejectedError("invalid", "category not found");
    if (cat.started) return; // idempotent — silent success
    (core as any).startCategory(s, catId);
  },
  ADVANCE_WINNER(s, payload) {
    const ref = (payload && payload.ref) || s.match.activeMatchRef;
    if (!ref) return;
    if (!s.match.activeMatchRef || (core as any).matchIdFromRef(s.match.activeMatchRef) !== (core as any).matchIdFromRef(ref)) {
      (core as any).loadMatchToScoreboardImpl(s, ref);
    }
    const m = (core as any).getMatchByRef(s, ref);
    if (!m) return;
    // Bracket winner already set (auto-finalize during scoring) — just
    // roll forward to the next match without re-running winner logic.
    if (m.winner) {
      let nextPre = null as any;
      const areaIdxPre = (payload as { areaIdx?: number | null })?.areaIdx;
      if (typeof areaIdxPre === "number" && s.engine?.nextMatchPerArea) {
        const hint = s.engine.nextMatchPerArea[areaIdxPre];
        if (hint?.matchId) nextPre = (core as any).refFromMatchId(hint.matchId);
      }
      if (!nextPre) nextPre = (core as any).findNextMatch(s, ref);
      if (nextPre) (core as any).loadMatchToScoreboardImpl(s, nextPre);
      return;
    }
    s.match.discipline = ref.discipline;
    const threshold = s.tournament.settings.pointDifference ?? 0;
    // Use the detailed call so we can surface "Más ippon/wasari/yuko"
    // for the brief banner before the bracket advances. Kata still uses
    // the simple computeKataWinner (no per-value buckets).
    let winnerSide: "blue" | "red" | null;
    let tieBreak: "ippon" | "wasari" | "yuko" | undefined;
    if (s.match.discipline === "kata") {
      winnerSide = (core as any).computeKataWinner(s.match);
    } else {
      const detail = (core as any).computeCombatWinnerDetailed(
        s.match,
        threshold > 0 ? threshold : undefined,
      );
      winnerSide = detail.side;
      tieBreak = detail.tieBreak;
    }
    if (!winnerSide) {
      s.jury = { competitors: [s.match.blueName, s.match.redName], context: { kind: "match", ref } };
      return;
    }
    if (tieBreak) s.match.tieBreakReason = tieBreak;
    const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
    const loserName = winnerSide === "blue" ? s.match.redName : s.match.blueName;
    if (tieBreak) {
      s.flash = {
        kind: "tiebreak",
        reason: tieBreak,
        winnerName,
        expiresAtMs: Date.now() + 3000,
      };
    }
    (core as any).finalizeMatchByRef(s, ref, winnerName, loserName, false);

    // Prefer the engine's per-area next-match hint so the scoreboard
    // and the NextMatchPanel agree. Falls back to a linear walk via
    // findNextMatch when no hint is available (no engine state yet,
    // or area unassigned for this subcategory).
    let next = null;
    const areaIdx = (payload as { areaIdx?: number | null })?.areaIdx;
    if (typeof areaIdx === "number" && s.engine?.nextMatchPerArea) {
      const hint = s.engine.nextMatchPerArea[areaIdx];
      if (hint?.matchId) {
        next = (core as any).refFromMatchId(hint.matchId);
      }
    }
    if (!next) next = (core as any).findNextMatch(s, ref);
    if (next) (core as any).loadMatchToScoreboardImpl(s, next);
  },
  SET_KATA_SCORE(s, { side, value }) {
    // Kata is judged on a single 0–5 scale. Whatever the operator awards
    // to one side, the other side automatically gets 5 − that. The
    // higher score wins immediately; the bracket advances and the next
    // match loads without further input.
    if (side !== "blue" && side !== "red") throw new ActionRejectedError("invalid", "bad side");
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ActionRejectedError("invalid", "bad value");
    }
    const v = Math.max(0, Math.min(5, Math.round(value)));
    const other = 5 - v;
    s.match.bluePoints = side === "blue" ? v : other;
    s.match.redPoints  = side === "red"  ? v : other;
    // No penalties / advantage in kata; force them off so a stale UI
    // can't accidentally tilt the decision.
    s.match.bluePenalties = 0;
    s.match.redPenalties  = 0;
    s.match.blueAdvantage = false;
    s.match.redAdvantage  = false;
    s.timer.running = false;

    const ref = s.match.activeMatchRef;
    if (!ref) return;
    const winnerSide = (core as any).computeKataWinner(s.match);
    if (!winnerSide) return; // shouldn't happen with 1..5 vs 4..0, but be safe
    const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
    const loserName  = winnerSide === "blue" ? s.match.redName  : s.match.blueName;
    (core as any).finalizeMatchByRef(s, ref, winnerName, loserName, false);
    s.timer.finished = true;
    // Don't auto-load the next match — operator presses Enter / Advance
    // to move on, so the just-decided kata stays visible for review.
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
    s.timer.finished = true;
    // Hold on this match until the operator advances explicitly.
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

// Action types that touch the live scoreboard (state.match) or timer
// and therefore must run inside the per-area slot wrapper.
const SCOREBOARD_ACTIONS = new Set([
  "SCORE_POINT",
  "ADD_PENALTY",
  "SET_ADVANTAGE",
  "TIMER_TOGGLE",
  "TIMER_ADJUST",
  "RESET_SCOREBOARD",
  "LOAD_EXTRA_MATCH",
  "SELECT_MATCH",
  "ADVANCE_WINNER",
  "SET_KATA_SCORE",
  "ELIMINATE",
]);

export function applyAction(state: AnyState, action: any): AnyState | null {
  const fn = handlers[action.actionType];
  if (!fn) throw new ActionRejectedError("invalid", `unknown action ${action.actionType}`);
  const payload = action.payload || {};
  let result: AnyState | void;
  if (SCOREBOARD_ACTIONS.has(action.actionType)) {
    // Route to the per-area scoreboard slot — keeps each console
    // independent so two areas can score concurrently.
    const areaIdx = typeof payload.areaIdx === "number" ? payload.areaIdx : 0;
    withArea(state, areaIdx, () => { result = fn(state, payload); });
  } else {
    result = fn(state, payload);
  }
  return result === undefined ? null : result;
}
