"use client";

// OverlayProvider — subscribes to `karate:overlay-open` / `karate:overlay-close`
// IPC and exposes `{ isOpen, getLocalAdminToken, requestClose }` to React.
//
// The local admin token is delivered by main process exactly when the overlay
// is opened, kept in a useRef (never in React state or localStorage), and
// cleared on close. Browser-only builds receive no IPC events — the overlay
// is unreachable there.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";

interface OverlayApi {
  isOpen: boolean;
  isListening: boolean;
  getLocalAdminToken: () => string | null;
  requestClose: () => Promise<void>;
}

const OverlayContext = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const overlay = window.__KARATE__?.overlay;
    if (!overlay) return;
    const offOpen = overlay.onOpen((payload) => {
      tokenRef.current = payload?.localAdminToken ?? null;
      setIsListening(false);
      setIsOpen(true);
    });
    const offClose = overlay.onClose(() => {
      tokenRef.current = null;
      setIsOpen(false);
    });
    const offListening = overlay.onListening?.(() => {
      setIsListening(true);
      setTimeout(() => setIsListening(false), 5000);
    }) ?? (() => {});
    return () => { offOpen(); offClose(); offListening(); };
  }, []);

  const requestClose = useCallback(async () => {
    if (typeof window === "undefined") return;
    const overlay = window.__KARATE__?.overlay;
    if (overlay) await overlay.requestClose();
    // setIsOpen/false will follow via onClose IPC; clear token defensively too.
    tokenRef.current = null;
    setIsOpen(false);
  }, []);

  const api: OverlayApi = useMemo(() => ({
    isOpen,
    isListening,
    getLocalAdminToken: () => tokenRef.current,
    requestClose,
  }), [isOpen, isListening, requestClose]);

  return <OverlayContext.Provider value={api}>{children}</OverlayContext.Provider>;
}

export function useOverlay(): OverlayApi {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error("useOverlay must be used inside <OverlayProvider>");
  return ctx;
}
