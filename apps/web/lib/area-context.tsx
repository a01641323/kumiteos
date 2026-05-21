"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "karate.currentArea";

interface AreaApi {
  /** Current area index. null = no area selected (or superadmin). */
  current: number | null;
  setArea: (idx: number | null) => void;
}

const AreaContext = createContext<AreaApi | null>(null);

export function AreaProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) setCurrent(n);
  }, []);

  const setArea = useCallback((idx: number | null) => {
    setCurrent(idx);
    if (typeof window === "undefined") return;
    if (idx === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(idx));
  }, []);

  const api = useMemo(() => ({ current, setArea }), [current, setArea]);
  return <AreaContext.Provider value={api}>{children}</AreaContext.Provider>;
}

export function useArea(): AreaApi {
  const ctx = useContext(AreaContext);
  if (!ctx) throw new Error("useArea must be used inside <AreaProvider>");
  return ctx;
}
