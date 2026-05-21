"use client";

// =============================================================
// LocalState — per-machine state that never leaves this renderer.
//
// Per Addition 2 of the spec, the machine that operates a scoreboard
// must hold its own "which match is loaded" independent of what other
// machines on the LAN are doing. Selecting a match in the bracket
// (#admin) writes to this context and never broadcasts to the server.
//
// Persistence: sessionStorage. Surviving Cmd+R is desirable so a
// referee doesn't lose their loaded match on accidental refresh.
// =============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ActiveMatchRef } from "@karate/core";

const STORAGE_KEY = "karate.localActiveMatchRef.v1";

interface LocalStateApi {
  /** Match this MACHINE has loaded onto its scoreboard. Local-only. */
  localActiveMatchRef: ActiveMatchRef | null;
  setLocalActiveMatchRef: (ref: ActiveMatchRef | null) => void;
}

const LocalStateContext = createContext<LocalStateApi | null>(null);

export function LocalStateProvider({ children }: { children: React.ReactNode }) {
  const [ref, setRef] = useState<ActiveMatchRef | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") setRef(parsed as ActiveMatchRef);
    } catch {}
  }, []);

  const setLocalActiveMatchRef = useCallback((next: ActiveMatchRef | null) => {
    setRef(next);
    if (typeof window === "undefined") return;
    try {
      if (next === null) window.sessionStorage.removeItem(STORAGE_KEY);
      else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const api = useMemo<LocalStateApi>(
    () => ({ localActiveMatchRef: ref, setLocalActiveMatchRef }),
    [ref, setLocalActiveMatchRef]
  );

  return <LocalStateContext.Provider value={api}>{children}</LocalStateContext.Provider>;
}

export function useLocalState(): LocalStateApi {
  const ctx = useContext(LocalStateContext);
  if (!ctx) throw new Error("useLocalState must be used inside <LocalStateProvider>");
  return ctx;
}
