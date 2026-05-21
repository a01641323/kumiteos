"use client";

import { useEffect, useRef } from "react";
import { useOverlay } from "@/lib/overlay-context";
import { SuperadminTerminal } from "./superadmin-terminal";

export function SuperadminOverlay() {
  const { isOpen } = useOverlay();
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      try { previousFocusRef.current?.focus(); } catch {}
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isOpen]);

  if (!isOpen) return null;

  return <SuperadminTerminal />;
}
