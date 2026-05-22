"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ActiveMatchRef,
  AppState,
  CategoryDef,
  Discipline,
  DisciplineMode,
  SubcategorySize,
} from "@karate/core";
import {
  CHANNEL_NAME,
  STORAGE_KEY,
  TIMER_OWNER_KEY,
  addCategoryDef as addCategoryDefImpl,
  addParticipant as addParticipantImpl,
  assignSubcategoryToArea as assignSubcategoryToAreaImpl,
  buildInitialState,
  computeCombatWinner,
  computeWinner,
  finalizeMatchByRef,
  findNextMatch,
  generateMockTournament,
  getMatchByRef,
  getSubcategory,
  loadMatchToScoreboardImpl,
  loadState,
  markParticipantArrived as markParticipantArrivedImpl,
  rebuildAllSubcategories,
  startCategory as startCategoryImpl,
  removeCategoryDef as removeCategoryDefImpl,
  removeParticipant as removeParticipantImpl,
  replaceParticipants as replaceParticipantsImpl,
  reseed as reseedImpl,
  resetLiveScoreboard,
  setAreaCount as setAreaCountImpl,
  setCategoryDefs as setCategoryDefsImpl,
  setLogoUrl as setLogoUrlImpl,
  updateCategoryDef as updateCategoryDefImpl,
} from "@karate/core";
import type { Participant } from "@karate/core";
import { isActionable, useNetwork } from "./network-context";
import { useArea } from "./area-context";
import { useLocalState } from "./local-state-context";
import * as Actions from "./store-actions";
import {
  OPTIMISTIC_TIMEOUT_MS,
  addEntry,
  applyAck,
  applyReject,
  applyTimeout,
  deltaForSide,
  reconcileWithState,
  type OptimisticMap,
} from "./optimistic";

type Updater = (s: AppState) => void;

interface StoreApi {
  state: AppState;
  update: (fn: Updater) => void;
  // High-level actions
  setActiveCategory: (catId: string) => void;
  setActiveSubcategory: (catId: string, subId: string) => void;
  setActiveDiscipline: (
    catId: string,
    subId: string,
    discipline: Discipline
  ) => void;
  loadMatch: (ref: ActiveMatchRef) => void;
  advanceActiveMatch: () => void;
  resolveJury: (chosenName: string) => void;
  applyTournamentSettings: (
    size: SubcategorySize,
    mode: DisciplineMode,
    pointDiff: number,
    skipConfirm?: boolean
  ) => boolean;
  replaceParticipants: (list: Omit<Participant, "id">[]) => void;
  addParticipant: (p: Omit<Participant, "id">) => void;
  removeParticipant: (id: string) => void;
  setCategoryDefs: (defs: CategoryDef[]) => void;
  addCategoryDef: (def: CategoryDef) => void;
  updateCategoryDef: (def: CategoryDef) => void;
  removeCategoryDef: (id: string, skipConfirm?: boolean) => void;
  reseed: (seed?: number, skipConfirm?: boolean) => void;
  setAreaCount: (n: number) => void;
  assignSubcategoryToArea: (subcategoryId: string, areaIndex: number) => void;
  setLogoUrl: (url: string | null) => void;
  /** Toggle a participant's arrival flag from the check-in tab. */
  markArrived: (participantId: string, arrived: boolean) => void;
  /**
   * Lock a category in for the day. Removes participants who didn't arrive,
   * builds the bracket, and unlocks the category for scoring.
   */
  startCategory: (catId: string) => void;
  /**
   * Toggle whether an area is operator-disabled. Disabled areas receive
   * no new match assignments; existing matches continue running.
   */
  setAreaDisabled: (areaIndex: number, disabled: boolean) => void;
  loadMockTournament: (skipConfirm?: boolean) => void;
  /**
   * Tournament-data wipe: drops every participant, every bracket, every
   * area assignment, and the live scoreboard. Keeps tournament settings
   * (subcategorySize / disciplineMode / pointDifference / areaCount),
   * category definitions, and the license / kiosk session. Use from the
   * superadmin terminal's `wipe` command.
   */
  wipeData: () => void;
  resetScoreboard: (skipConfirm?: boolean) => void;
  eliminate: (side: "blue" | "red") => void;
  addPoints: (side: "blue" | "red", n: number) => void;
  /** Kata-only: set the selected side's score (0–5). Opponent gets 5−value;
   *  the higher score wins immediately. */
  setKataScore: (side: "blue" | "red", value: number) => void;
  /** Training/sparring: load a blank scoreboard with no bracket linkage.
   *  Discards current match progress; the result does NOT affect the
   *  tournament. */
  loadExtraMatch: (discipline: "combat" | "kata") => void;
  setAdvantage: (side: "blue" | "red", value: boolean) => void;
  addPenalty: (side: "blue" | "red", delta: number) => void;
  adjustTimer: (deltaSeconds: number) => void;
  togglePause: () => void;
  saveAppSettings: (
    duration: number,
    keys: AppState["settings"]["keys"]
  ) => void;
  /** True when the store is willing to dispatch actions right now. */
  actionable: boolean;
}

const StoreContext = createContext<StoreApi | null>(null);

const TAB_ID = Math.random().toString(36).slice(2);

function deepClone<T>(x: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(x)
    : JSON.parse(JSON.stringify(x));
}

function applyLocalActiveMatch(state: AppState, ref: ActiveMatchRef): AppState {
  // Look up the bracket match for the local ref and project it onto
  // state.match so the scoreboard renders THIS machine's loaded match
  // (independent of what the server's global state.match currently says).
  const sub = state.tournament.categories[ref.categoryId]?.subcategories.find((s) => s.id === ref.subcategoryId);
  if (!sub) return state;
  let p1: string | null = null;
  let p2: string | null = null;
  const tree = sub.trees[ref.discipline] as unknown as {
    rounds?: Array<Array<{ p1: string | null; p2: string | null }>>;
    bracket?: { rounds: Array<Array<{ p1: string | null; p2: string | null }>> };
    extra?: { p1: string | null; p2: string | null };
    matches?: Array<{ p1: string | null; p2: string | null; pair?: string }>;
    thirdPlace?: { p1: string | null; p2: string | null };
  } | undefined;
  if (!tree) return state;
  if (ref.path.kind === "std") {
    const rounds = tree.rounds ?? tree.bracket?.rounds;
    const m = rounds?.[ref.path.round]?.[ref.path.idx];
    if (m) { p1 = m.p1; p2 = m.p2; }
  } else if (ref.path.kind === "playin") {
    if (tree.extra) { p1 = tree.extra.p1; p2 = tree.extra.p2; }
  } else if (ref.path.kind === "series") {
    const m = tree.matches?.[ref.path.idx];
    if (m) { p1 = m.p1; p2 = m.p2; }
  } else if (ref.path.kind === "rr") {
    const m = tree.matches?.find((mm) => mm.pair === (ref.path as { kind: "rr"; pair: string }).pair);
    if (m) { p1 = m.p1; p2 = m.p2; }
  } else if (ref.path.kind === "3rd") {
    if (tree.thirdPlace) { p1 = tree.thirdPlace.p1; p2 = tree.thirdPlace.p2; }
  }
  // Compare to server's current activeMatchRef; if identical, preserve the
  // server's scoring values (so a single-machine session still works the
  // way it always did). Otherwise, reset to a blank scoreboard locally —
  // another machine's scoring activity must not bleed into ours.
  const serverRef = state.match.activeMatchRef;
  const sameAsServer = serverRef
    && serverRef.categoryId === ref.categoryId
    && serverRef.subcategoryId === ref.subcategoryId
    && serverRef.discipline === ref.discipline
    && JSON.stringify(serverRef.path) === JSON.stringify(ref.path);
  if (sameAsServer) {
    return {
      ...state,
      match: {
        ...state.match,
        activeMatchRef: ref,
        blueName: p1 ?? state.match.blueName,
        redName: p2 ?? state.match.redName,
        discipline: ref.discipline,
      },
    };
  }
  return {
    ...state,
    match: {
      ...state.match,
      activeMatchRef: ref,
      blueName: p1 ?? "",
      redName: p2 ?? "",
      bluePoints: 0,
      redPoints: 0,
      bluePenalties: 0,
      redPenalties: 0,
      blueAdvantage: false,
      redAdvantage: false,
      blueEliminated: false,
      redEliminated: false,
      discipline: ref.discipline,
    },
  };
}

function mergeOptimistic(state: AppState, optimistic: OptimisticMap): AppState {
  if (optimistic.size === 0) return state;
  const blueDelta = deltaForSide(optimistic, "blue");
  const redDelta = deltaForSide(optimistic, "red");
  if (blueDelta === 0 && redDelta === 0) return state;
  return {
    ...state,
    match: {
      ...state.match,
      bluePoints: state.match.bluePoints + blueDelta,
      redPoints: state.match.redPoints + redDelta,
    },
  };
}

function sendAction(env: ReturnType<typeof Actions.scorePoint>): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return Promise.resolve({ ok: false, error: "no_window" });
  const net = window.__KARATE__?.network;
  if (!net) return Promise.resolve({ ok: false, error: "no_network" });
  return net.sendAction(env);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { status, networkState, networkStateVersion } = useNetwork();
  const { localActiveMatchRef, setLocalActiveMatchRef } = useLocalState();
  const { current: currentAreaIdx } = useArea();
  const mode = status.mode;
  const actionable = isActionable(status);

  const [localState, setLocalState] = useState<AppState>(() => buildInitialState());
  const [optimistic, setOptimistic] = useState<OptimisticMap>(new Map());
  const localStateRef = useRef(localState);
  localStateRef.current = localState;
  const channelRef = useRef<BroadcastChannel | null>(null);
  const prevRemainingRef = useRef<number>(localState.timer.remaining);
  const prevWarnedAtRef = useRef<number | undefined>(undefined);
  const prevExpiredAtRef = useRef<number | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Hydrate local-state from localStorage on mount (used only in STANDALONE,
  // but we keep it warm so a STANDALONE → SERVER first-time enable can hand
  // its current snapshot off via importLocalState).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const loaded = loadState(window.localStorage);
    setLocalState(loaded);
    localStateRef.current = loaded;
  }, []);

  // BroadcastChannel: same-browser multi-tab sync (e.g. the public-display
  // tab the operator drags to their second monitor).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("BroadcastChannel" in window)) return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      if (!ev.data || ev.data.from === TAB_ID) return;
      if (modeRef.current !== "standalone") return; // network state wins
      setLocalState(ev.data.state as AppState);
    };
    const onStorage = (ev: StorageEvent) => {
      if (modeRef.current !== "standalone") return;
      if (ev.key !== STORAGE_KEY || !ev.newValue) return;
      try { setLocalState(JSON.parse(ev.newValue) as AppState); } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => {
      ch.close();
      channelRef.current = null;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Rebroadcast networked state to same-machine BC consumers (public window).
  useEffect(() => {
    if (mode === "standalone") return;
    if (!networkState) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(networkState));
    } catch {}
    channelRef.current?.postMessage({ from: TAB_ID, state: networkState });
    setOptimistic((prev) => reconcileWithState(prev, networkStateVersion));
  }, [mode, networkState, networkStateVersion]);

  // Listen for action acks/rejects from main process to update optimistic map.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const net = window.__KARATE__?.network;
    if (!net) return;
    const offAck = net.onAck(({ actionId, newVersion }) => {
      setOptimistic((prev) => applyAck(prev, actionId, newVersion));
    });
    const offRej = net.onRejected(({ actionId }) => {
      setOptimistic((prev) => applyReject(prev, actionId));
    });
    return () => { offAck(); offRej(); };
  }, []);

  const publishLocal = useCallback((next: AppState) => {
    if (modeRef.current !== "standalone") return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    channelRef.current?.postMessage({ from: TAB_ID, state: next });
  }, []);

  // Update path used by STANDALONE actions and by networked complex actions
  // (which fork-then-send REPLACE_STATE).
  const updateLocal = useCallback(
    (fn: Updater): AppState => {
      const next = deepClone(localStateRef.current);
      fn(next);
      setLocalState(next);
      localStateRef.current = next;
      publishLocal(next);
      return next;
    },
    [publishLocal]
  );

  // Public `update`. In STANDALONE, mutate local state directly. In networked
  // modes, fork the current networked state, apply the mutation, and ask the
  // server to adopt the result.
  const update = useCallback(
    (fn: Updater) => {
      if (modeRef.current === "standalone") {
        updateLocal(fn);
        return;
      }
      // CRITICAL: never fall back to buildInitialState() here. If the
      // renderer hasn't received the host's snapshot yet (e.g. immediately
      // after a cmd+R while connected as a guest), forking from an empty
      // state and sending REPLACE_STATE would WIPE the host's tournament.
      // Drop the action and let the user retry once state has hydrated.
      if (!networkState) {
        if (typeof window !== "undefined") {
          console.warn("[karate-store] update dropped: network state not loaded yet");
        }
        return;
      }
      const candidate = deepClone(networkState);
      fn(candidate);
      void sendAction(Actions.replaceState(candidate));
    },
    [networkState, updateLocal]
  );

  // ---- STANDALONE-only timer tick (mirrors the legacy owner-elected loop) ----
  useEffect(() => {
    if (mode !== "standalone") return;
    const id = setInterval(() => {
      if (typeof window === "undefined") return;
      if (!window.location.pathname.startsWith("/private")) return;

      // Heartbeat-based ownership: steal if stored owner has not written a heartbeat
      // in the last 2.5 s (handles stale keys from previous sessions and pushState
      // navigation that never fires popstate).
      const now = Date.now();
      const owner = window.localStorage.getItem(TIMER_OWNER_KEY);
      if (owner !== TAB_ID) {
        const hb = parseInt(window.localStorage.getItem("karate-timer-hb-v5") ?? "0", 10);
        if (now - hb < 2500) return; // Another tab is actively ticking
        window.localStorage.setItem(TIMER_OWNER_KEY, TAB_ID);
      }
      window.localStorage.setItem("karate-timer-hb-v5", String(now));

      const cur = localStateRef.current;
      const t = cur.timer;
      if (!t.running || t.remaining <= 0) return;
      if (cur.match.discipline === "kata") return;
      updateLocal((s) => {
        const tt = s.timer;
        if (!tt.running || tt.remaining <= 0) return;
        tt.remaining = Math.max(0, tt.remaining - 1);
        if (prevRemainingRef.current > 15 && tt.remaining === 15) {
          beep(900, 0.22);
        }
        if (tt.remaining === 0) {
          tt.running = false;
          tt.finished = true;
          tripleBeep();
        }
        prevRemainingRef.current = tt.remaining;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [mode, updateLocal]);

  // ---- Server-driven timer transition beeps (CLIENT / SERVER modes) ----
  useEffect(() => {
    if (mode === "standalone") return;
    if (!networkState) return;
    const t = networkState.timer;
    if (t.warnedAt && t.warnedAt !== prevWarnedAtRef.current) {
      prevWarnedAtRef.current = t.warnedAt;
      beep(900, 0.22);
    }
    if (t.expiredAt && t.expiredAt !== prevExpiredAtRef.current) {
      prevExpiredAtRef.current = t.expiredAt;
      tripleBeep();
    }
  }, [mode, networkState]);

  // ---- Effective state used by all consumers ----
  // Per Addition 2: in networked modes, the "which match is loaded on this
  // machine" is local state, not server state. Override `state.match` from
  // the bracket lookup of the local ref so each machine sees its own match.
  const baseState = mode === "standalone" ? localState : (networkState ?? buildInitialState());
  // The earlier "per-machine independent scoreboard" projection
  // (applyLocalActiveMatch) zeroed bluePoints/redPoints whenever the
  // renderer's local ref disagreed with the server's by even one tick,
  // which created a window where SCORE_POINT looked silent because the
  // displayed scoring stayed at zero. Single-machine operation never
  // benefited from that projection — the server is the single source of
  // truth for the live match. Drop it; trust state.match as-is.
  const stateWithLocalMatch = baseState;
  const state = mergeOptimistic(stateWithLocalMatch, optimistic);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---- Helpers used by action methods ----
  function sendNamed(env: ReturnType<typeof Actions.scorePoint>) {
    void sendAction(env);
  }

  function dispatchScore(side: "blue" | "red", n: number) {
    if (!actionable) return;
    if (mode === "standalone") {
      updateLocal((s) => {
        if (side === "blue") s.match.bluePoints = Math.max(0, s.match.bluePoints + n);
        else s.match.redPoints = Math.max(0, s.match.redPoints + n);
        const ref = s.match.activeMatchRef;
        const threshold = s.tournament.settings.pointDifference ?? 0;
        if (ref && s.match.discipline === "combat" && threshold > 0) {
          const diff = s.match.bluePoints - s.match.redPoints;
          const winnerSide: "blue" | "red" | null =
            diff >= threshold ? "blue" : -diff >= threshold ? "red" : null;
          if (winnerSide) {
            s.timer.running = false;
            s.timer.finished = true;
            const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
            const loserName = winnerSide === "blue" ? s.match.redName : s.match.blueName;
            finalizeMatchByRef(s, ref, winnerName, loserName, false);
            // Hold on this match — operator presses Enter/Advance to roll on.
          }
        }
      });
      return;
    }
    const env = Actions.scorePoint(side, n);
    // Optimistic overlay only on CLIENT; SERVER mode's IPC roundtrip is fast
    // enough that the overlay isn't needed (and would clutter the canonical
    // state shown to other clients via BC).
    if (mode === "client") {
      setOptimistic((prev) =>
        addEntry(prev, env.actionId, {
          side, n,
          newVersionExpected: null,
          queuedAt: Date.now(),
        })
      );
      setTimeout(() => {
        setOptimistic((prev) => applyTimeout(prev, env.actionId));
      }, OPTIMISTIC_TIMEOUT_MS);
    }
    sendNamed(env);
  }

  // ---- Action implementations ----
  const api: StoreApi = useMemo(
    () => ({
      state,
      update,
      actionable,
      setActiveCategory: (catId) => {
        if (mode === "standalone") {
          updateLocal((s) => { s.tournament.activeCategoryId = catId; });
        } else {
          if (!actionable) return;
          sendNamed(Actions.setActiveCategory(catId));
        }
      },
      setActiveSubcategory: (catId, subId) => {
        if (mode === "standalone") {
          updateLocal((s) => {
            const cat = s.tournament.categories[catId];
            if (cat) cat.activeSubcategoryId = subId;
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.setActiveSubcategory(catId, subId));
        }
      },
      setActiveDiscipline: (catId, subId, discipline) => {
        if (mode === "standalone") {
          updateLocal((s) => {
            const sub = getSubcategory(s, catId, subId);
            if (sub) sub.activeDiscipline = discipline;
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.setActiveDiscipline(catId, subId, discipline));
        }
      },
      loadMatch: (ref) => {
        if (mode === "standalone") {
          updateLocal((s) => { loadMatchToScoreboardImpl(s, ref); });
          return;
        }
        if (!actionable) return;
        // Server is the single source of truth for the live scoreboard.
        // The earlier "per-machine local selection" path stopped working
        // once applyLocalActiveMatch was dropped, leaving bracket clicks
        // with no visible effect. Send SELECT_MATCH so every machine sees
        // the chosen match.
        sendNamed(Actions.selectMatch(ref));
        if (localActiveMatchRef) setLocalActiveMatchRef(null);
      },
      advanceActiveMatch: () => {
        if (mode === "standalone") {
          updateLocal((s) => {
            const ref = s.match.activeMatchRef;
            if (!ref) return;
            const m = getMatchByRef(s, ref);
            if (!m) return;
            // Bracket winner already set (auto-finalize during scoring) —
            // just roll forward to the next match.
            if (m.winner) {
              const next = findNextMatch(s, ref);
              if (next) loadMatchToScoreboardImpl(s, next);
              return;
            }
            s.match.discipline = ref.discipline;
            const threshold = s.tournament.settings.pointDifference ?? 0;
            const winnerSide = computeWinner(s.match, threshold > 0 ? threshold : undefined);
            if (!winnerSide) {
              s.jury = { competitors: [s.match.blueName, s.match.redName], context: { kind: "match", ref } };
              return;
            }
            const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
            const loserName = winnerSide === "blue" ? s.match.redName : s.match.blueName;
            finalizeMatchByRef(s, ref, winnerName, loserName, false);
            const next = findNextMatch(s, ref);
            if (next) loadMatchToScoreboardImpl(s, next);
          });
        } else {
          if (!actionable) return;
          // Pass local ref so the server finalizes the correct match
          // even when match selection is held only on this machine.
          sendNamed(Actions.advanceWinner(
            localActiveMatchRef ?? stateRef.current.match.activeMatchRef ?? undefined,
            currentAreaIdx,
          ));
          // Clear local selection — bracket has advanced, the operator will
          // pick the next match.
          if (localActiveMatchRef) setLocalActiveMatchRef(null);
        }
      },
      resolveJury: (chosenName) => {
        if (mode === "standalone") {
          updateLocal((s) => {
            if (!s.jury) return;
            const j = s.jury;
            const other = j.competitors[0] === chosenName ? j.competitors[1] : j.competitors[0];
            const ctx = j.context;
            let searchFromRef: ActiveMatchRef | null = null;
            if (ctx.kind === "match") {
              searchFromRef = ctx.ref;
              finalizeMatchByRef(s, ctx.ref, chosenName, other, true);
            } else if (ctx.kind === "series-final") {
              const sub = getSubcategory(s, ctx.subRef.categoryId, ctx.subRef.subcategoryId);
              if (sub) {
                const tree = sub.trees[ctx.subRef.discipline] as { winner: string | null; juryDecided: boolean };
                tree.winner = chosenName;
                tree.juryDecided = true;
              }
              searchFromRef = { ...ctx.subRef, path: { kind: "series", idx: 1 } };
            } else if (ctx.kind === "rr-final") {
              const sub = getSubcategory(s, ctx.subRef.categoryId, ctx.subRef.subcategoryId);
              if (sub) {
                const tree = sub.trees[ctx.subRef.discipline] as { winner: string | null; juryDecided: boolean };
                tree.winner = chosenName;
                tree.juryDecided = true;
              }
              searchFromRef = { ...ctx.subRef, path: { kind: "rr", pair: "bc" } };
            }
            s.jury = null;
            if (searchFromRef) {
              const next = findNextMatch(s, searchFromRef);
              if (next) loadMatchToScoreboardImpl(s, next);
            }
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.resolveJury(chosenName));
        }
      },
      applyTournamentSettings: (size, mode_, pointDiff, skipConfirm) => {
        const cur = stateRef.current.tournament.settings;
        const structureChanged = cur.subcategorySize !== size || cur.disciplineMode !== mode_;
        if (!structureChanged && cur.pointDifference === pointDiff) return false;
        const ok = !structureChanged ||
          skipConfirm ||
          (typeof window !== "undefined" ? window.confirm("This will reset all bracket progress. Continue?") : true);
        if (!ok) return false;
        update((s) => {
          s.tournament.settings.pointDifference = pointDiff;
          if (structureChanged) {
            s.tournament.settings.subcategorySize = size;
            s.tournament.settings.disciplineMode = mode_;
            rebuildAllSubcategories(s);
            resetLiveScoreboard(s);
            s.jury = null;
          }
        });
        return true;
      },
      replaceParticipants: (list) => update((s) => replaceParticipantsImpl(s, list)),
      addParticipant: (p) => update((s) => addParticipantImpl(s, p)),
      removeParticipant: (id) => update((s) => removeParticipantImpl(s, id)),
      setCategoryDefs: (defs) => update((s) => setCategoryDefsImpl(s, defs)),
      addCategoryDef: (def) => update((s) => addCategoryDefImpl(s, def)),
      updateCategoryDef: (def) => update((s) => updateCategoryDefImpl(s, def)),
      removeCategoryDef: (id, skipConfirm) => {
        const ok = skipConfirm ||
          (typeof window !== "undefined"
            ? window.confirm("Delete this category definition? Participants matching this definition will become unassigned until you create a new one.")
            : true);
        if (!ok) return;
        update((s) => removeCategoryDefImpl(s, id));
      },
      reseed: (seed, skipConfirm) => {
        if (typeof seed !== "number") {
          const ok = skipConfirm ||
            (typeof window !== "undefined"
              ? window.confirm("This will reset all bracket progress and reassign all competitors randomly. Continue?")
              : true);
          if (!ok) return;
        }
        update((s) => { reseedImpl(s, seed); });
      },
      setAreaCount: (n) => update((s) => setAreaCountImpl(s, n)),
      assignSubcategoryToArea: (subId, areaIdx) => update((s) => assignSubcategoryToAreaImpl(s, subId, areaIdx)),
      setLogoUrl: (url) => update((s) => setLogoUrlImpl(s, url)),
      markArrived: (participantId, arrived) => {
        if (mode === "standalone") {
          updateLocal((s) => { markParticipantArrivedImpl(s, participantId, arrived); });
        } else {
          if (!actionable) return;
          sendNamed(Actions.markArrived(participantId, arrived));
        }
      },
      startCategory: (catId) => {
        if (mode === "standalone") {
          updateLocal((s) => { startCategoryImpl(s, catId); });
        } else {
          if (!actionable) return;
          sendNamed(Actions.startCategory(catId));
        }
      },
      setAreaDisabled: (areaIndex, disabled) => {
        if (mode === "standalone") {
          updateLocal((s) => {
            const n = s.tournament.settings.areaCount ?? 1;
            const cur = new Set<number>(s.tournament.disabledAreas ?? []);
            if (disabled) cur.add(areaIndex); else cur.delete(areaIndex);
            if (cur.size >= n) return; // refuse to disable last enabled area
            s.tournament.disabledAreas = [...cur].sort((a, b) => a - b);
          });
          return;
        }
        if (!actionable) return;
        sendNamed(Actions.setAreaDisabled(areaIndex, disabled));
      },
      loadMockTournament: (skipConfirm) => {
        const ok = skipConfirm ||
          (typeof window !== "undefined"
            ? window.confirm("Replace the current participants and category definitions with the demo tournament?")
            : true);
        if (!ok) return;
        update((s) => {
          const mock = generateMockTournament();
          s.tournament.categoryDefs = mock.categoryDefs;
          replaceParticipantsImpl(s, mock.participants.map(({ id: _id, ...rest }) => rest));
        });
      },
      wipeData: () => {
        // Confirmation is handled in the terminal (two-stage), so this
        // path is the actual mutation. Drop participants → rebuildAll
        // empties every category bracket. Reset scoreboard separately
        // because replaceParticipants doesn't touch s.match.
        update((s) => {
          replaceParticipantsImpl(s, []);
          s.tournament.areaAssignments = {};
          resetLiveScoreboard(s);
          s.jury = null;
        });
      },
      resetScoreboard: (skipConfirm) => {
        const ok = skipConfirm ||
          (typeof window !== "undefined"
            ? window.confirm("Reset the scoreboard? All current values will be cleared.")
            : true);
        if (!ok) return;
        if (mode === "standalone") {
          updateLocal((s) => resetLiveScoreboard(s));
        } else {
          if (!actionable) return;
          sendNamed(Actions.resetScoreboard());
        }
      },
      eliminate: (side) => {
        const cur = stateRef.current;
        const name = side === "blue" ? cur.match.blueName : cur.match.redName;
        if (!name) {
          if (typeof window !== "undefined") window.alert("No competitor loaded.");
          return;
        }
        const ok = typeof window !== "undefined"
          ? window.confirm(`Eliminate ${name}? The opponent will advance.`)
          : true;
        if (!ok) return;
        if (mode === "standalone") {
          updateLocal((s) => {
            if (side === "blue") s.match.blueEliminated = true;
            else s.match.redEliminated = true;
            s.timer.running = false;
            const ref = s.match.activeMatchRef;
            if (ref) {
              s.match.discipline = ref.discipline;
              const threshold = s.tournament.settings.pointDifference ?? 0;
              const winnerSide = computeWinner(s.match, threshold > 0 ? threshold : undefined);
              if (!winnerSide) {
                s.jury = { competitors: [s.match.blueName, s.match.redName], context: { kind: "match", ref } };
                return;
              }
              const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
              const loserName = winnerSide === "blue" ? s.match.redName : s.match.blueName;
              finalizeMatchByRef(s, ref, winnerName, loserName, false);
              s.timer.finished = true;
              // Hold on this match — operator presses Enter/Advance to roll on.
            }
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.eliminate(side, localActiveMatchRef ?? stateRef.current.match.activeMatchRef ?? undefined));
          if (localActiveMatchRef) setLocalActiveMatchRef(null);
        }
      },
      addPoints: (side, n) => dispatchScore(side, n),
      loadExtraMatch: (discipline) => {
        if (!actionable && mode !== "standalone") return;
        if (mode === "standalone") {
          updateLocal((s) => {
            resetLiveScoreboard(s);
            s.match.blueName = "Atleta A";
            s.match.redName  = "Atleta B";
            s.match.discipline = discipline;
            s.match.activeMatchRef = null;
            s.timer.duration  = s.settings.defaultDuration;
            s.timer.remaining = s.settings.defaultDuration;
            s.timer.running = false;
            s.timer.finished = false;
          });
        } else {
          sendNamed(Actions.loadExtraMatch(discipline));
        }
      },
      setKataScore: (side, value) => {
        if (!actionable && mode !== "standalone") return;
        if (mode === "standalone") {
          updateLocal((s) => {
            // Mirror the SET_KATA_SCORE reducer in standalone mode so
            // tests / single-machine usage stays consistent.
            const v = Math.max(0, Math.min(5, Math.round(value)));
            const other = 5 - v;
            s.match.bluePoints = side === "blue" ? v : other;
            s.match.redPoints  = side === "red"  ? v : other;
            s.match.bluePenalties = 0;
            s.match.redPenalties  = 0;
            s.match.blueAdvantage = false;
            s.match.redAdvantage  = false;
            s.timer.running = false;
            const ref = s.match.activeMatchRef;
            if (!ref) return;
            const winnerSide = computeWinner(s.match);
            if (!winnerSide) return;
            const winnerName = winnerSide === "blue" ? s.match.blueName : s.match.redName;
            const loserName  = winnerSide === "blue" ? s.match.redName  : s.match.blueName;
            finalizeMatchByRef(s, ref, winnerName, loserName, false);
            s.timer.finished = true;
            // Hold on this match — operator presses Enter/Advance to roll on.
          });
        } else {
          sendNamed(Actions.setKataScore(side, value));
        }
      },
      setAdvantage: (side, value) => {
        if (mode === "standalone") {
          updateLocal((s) => {
            if (side === "blue") s.match.blueAdvantage = value;
            else s.match.redAdvantage = value;
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.setAdvantage(side, value));
        }
      },
      addPenalty: (side, delta) => {
        if (mode === "standalone") {
          updateLocal((s) => {
            const key = side === "blue" ? "bluePenalties" : "redPenalties";
            s.match[key] = Math.max(0, Math.min(5, s.match[key] + delta));
            if (s.match[key] === 5 && delta > 0) s.timer.running = false;
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.addPenalty(side, delta));
        }
      },
      adjustTimer: (delta) => {
        if (mode === "standalone") {
          updateLocal((s) => {
            s.timer.remaining = Math.max(0, s.timer.remaining + delta);
            if (s.timer.remaining > 0) s.timer.finished = false;
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.timerAdjust(delta));
        }
      },
      togglePause: () => {
        if (mode === "standalone") {
          updateLocal((s) => {
            if (s.timer.remaining <= 0) return;
            s.timer.running = !s.timer.running;
            if (s.timer.running) s.timer.finished = false;
          });
        } else {
          if (!actionable) return;
          sendNamed(Actions.timerToggle());
        }
      },
      saveAppSettings: (duration, keys) => {
        update((s) => {
          if (Number.isFinite(duration) && duration > 0) {
            s.settings.defaultDuration = duration;
            if (!s.timer.running && s.timer.remaining === s.timer.duration) {
              s.timer.remaining = duration;
            }
            s.timer.duration = duration;
          }
          s.settings.keys = keys;
        });
      },
    }),
    [state, update, updateLocal, mode, actionable, networkState, localActiveMatchRef, setLocalActiveMatchRef, currentAreaIdx]
  );

  return (
    <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
  );
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

// =============================================================
// Audio helpers (Web Audio API)
// =============================================================
let audioCtx: AudioContext | null = null;
function ensureAudio(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}
export function beep(freq = 800, duration = 0.18, gain = 0.18) {
  if (typeof window === "undefined") return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}
export function tripleBeep() {
  beep(900, 0.18);
  setTimeout(() => beep(900, 0.18), 250);
  setTimeout(() => beep(1200, 0.32), 500);
}
if (typeof window !== "undefined") {
  ["click", "keydown"].forEach((t) =>
    window.addEventListener(t, () => ensureAudio(), { once: true })
  );
}
