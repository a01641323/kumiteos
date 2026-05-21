// In-memory authoritative master state with monotonic versioning.

import * as core from "@karate/core";
import { applyAction, ActionRejectedError } from "./actions";

type AnyState = any;

function snapshotMatchKeys(state: AnyState): Map<string, { ref: any; winner: any }> {
  const out = new Map<string, { ref: any; winner: any }>();
  for (const catId of state.tournament.categoryOrder || []) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    for (const sub of cat.subcategories) {
      for (const d of Object.keys(sub.trees)) {
        const tree = sub.trees[d];
        if (!tree) continue;
        const visit = (m: any, ref: any) => {
          const id = (core as any).matchIdFromRef(ref);
          out.set(id, { ref, winner: m.winner || null });
        };
        if (sub.type === "standard") {
          for (let r = 0; r < tree.rounds.length; r++) {
            for (let i = 0; i < tree.rounds[r].length; i++) {
              visit(tree.rounds[r][i], { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "std", round: r, idx: i } });
            }
          }
          if (tree.thirdPlace) visit(tree.thirdPlace, { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "3rd" } });
        } else if (sub.type === "playin") {
          visit(tree.extra, { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "playin" } });
          for (let r = 0; r < tree.bracket.rounds.length; r++) {
            for (let i = 0; i < tree.bracket.rounds[r].length; i++) {
              visit(tree.bracket.rounds[r][i], { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "std", round: r, idx: i } });
            }
          }
        } else if (sub.type === "series") {
          for (let i = 0; i < tree.matches.length; i++) {
            visit(tree.matches[i], { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "series", idx: i } });
          }
        } else if (sub.type === "roundrobin") {
          for (const mm of tree.matches) {
            if (!mm.pair) continue;
            visit(mm, { categoryId: catId, subcategoryId: sub.id, discipline: d, path: { kind: "rr", pair: mm.pair } });
          }
        }
      }
    }
  }
  return out;
}

function diffAndEmitEngineEvents(prevMap: Map<string, any>, state: AnyState, now: number) {
  const nextMap = snapshotMatchKeys(state);
  for (const [id, after] of nextMap) {
    const before = prevMap.get(id);
    if (after.winner && (!before || !before.winner)) {
      try { (core as any).recordMatchEnd(state, id, now); } catch {}
    }
  }
  const ref = state.match && state.match.activeMatchRef;
  if (ref) {
    const id = (core as any).matchIdFromRef(ref);
    const eng = state.engine;
    if (eng && eng.matches[id] && eng.matches[id].status !== "IN_PROGRESS" && eng.matches[id].status !== "COMPLETED") {
      const areaIndex = state.tournament.areaAssignments?.[ref.subcategoryId];
      if (typeof areaIndex === "number") {
        try { (core as any).recordMatchStart(state, id, areaIndex, now); } catch {}
      }
    }
  }
  return nextMap;
}

function tickEngine(state: AnyState) {
  try { (core as any).runEngineTick(state, { now: Date.now() }); }
  catch (err) { console.warn("[karate-engine] tick failed:", (err as Error)?.message); }
}

export interface StateStore {
  getState(): AnyState;
  getVersion(): number;
  replaceAll(next: AnyState): { state: AnyState; version: number };
  apply(action: any): { state: AnyState; version: number };
  tickEngineOnly(): { state: AnyState; version: number };
}

export function makeStateStore(initialState?: AnyState): StateStore {
  let state: AnyState = initialState ?? (core as any).buildInitialState();
  let version = 1;

  try { (core as any).ensureEngineState(state); (core as any).runEngineTick(state, { now: Date.now() }); } catch {}

  return {
    getState() { return state; },
    getVersion() { return version; },
    replaceAll(next: AnyState) {
      state = next;
      try { (core as any).ensureEngineState(state); } catch {}
      tickEngine(state);
      version += 1;
      return { state, version };
    },
    apply(action: any) {
      const prevMap = snapshotMatchKeys(state);
      const result = applyAction(state, action);
      if (result && action.actionType === "REPLACE_STATE") {
        state = result;
        try { (core as any).ensureEngineState(state); } catch {}
      }
      diffAndEmitEngineEvents(prevMap, state, Date.now());
      tickEngine(state);
      version += 1;
      return { state, version };
    },
    tickEngineOnly() {
      tickEngine(state);
      version += 1;
      return { state, version };
    },
  };
}

export { ActionRejectedError };
