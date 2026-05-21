"use client";

import { useEffect, useRef, useState } from "react";
import type { CommandKey } from "@karate/core";
import { useStore } from "@/lib/store";

interface InputState {
  selected: "blue" | "red" | null;
  undoArmed: boolean;
  expiresAt: number;
}

interface Props {
  /** When true, all keyboard input is suppressed (e.g. modal open). */
  suppress: boolean;
}

export function KeyboardHandler({ suppress }: Props) {
  const {
    state,
    addPoints,
    setAdvantage,
    addPenalty,
    adjustTimer,
    togglePause,
    advanceActiveMatch,
    actionable,
  } = useStore();
  const [tick, setTick] = useState(0);
  const inputRef = useRef<InputState>({
    selected: null,
    undoArmed: false,
    expiresAt: 0,
  });
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const reset = () => {
    inputRef.current = { selected: null, undoArmed: false, expiresAt: 0 };
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setTick((x) => x + 1);
  };

  const select = (side: "blue" | "red") => {
    inputRef.current = { selected: side, undoArmed: false, expiresAt: Date.now() + 5000 };
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(reset, 5000);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => setTick((x) => x + 1), 200);
    setTick((x) => x + 1);
  };

  useEffect(() => {
    if (suppress) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (state.jury) return;
      if (!actionable) return;

      const k = state.settings.keys;
      const key = e.key;
      const lk = key.length === 1 ? key.toLowerCase() : key;
      const norm = (s: string) =>
        typeof s === "string" && s.length === 1 ? s.toLowerCase() : s;
      const isKata = state.match.discipline === "kata";

      // Prevent browser navigation/scroll for any key our app owns,
      // regardless of game state (before isKata / selected guards).
      const ownedKeys = new Set([
        k.pauseTimer, k.addSecond, k.subSecond, k.undo, "Enter",
        k.add1, k.add2, k.add3,
        norm(k.selectRed), norm(k.selectBlue),
        norm(k.senshu), norm(k.penalty),
      ]);
      if (ownedKeys.has(lk) || ownedKeys.has(key)) e.preventDefault();

      if (key === k.pauseTimer || (k.pauseTimer === " " && key === " ")) {
        if (isKata) return;
        togglePause();
        return;
      }
      if (key === k.addSecond) {
        if (isKata) return;
        adjustTimer(1);
        return;
      }
      if (key === k.subSecond) {
        if (isKata) return;
        adjustTimer(-1);
        return;
      }
      if (lk === norm(k.selectRed)) {
        select("red");
        return;
      }
      if (lk === norm(k.selectBlue)) {
        select("blue");
        return;
      }
      if (key === "Enter") {
        advanceActiveMatch();
        return;
      }
      const cur = inputRef.current;
      if (!cur.selected) return;

      if (key === k.undo) {
        cur.undoArmed = !cur.undoArmed;
        if (cur.undoArmed) {
          cur.expiresAt = Date.now() + 5000;
          if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
          timeoutRef.current = window.setTimeout(reset, 5000);
        }
        setTick((x) => x + 1);
        return;
      }
      const sign = cur.undoArmed ? -1 : 1;
      const sel = cur.selected;
      if (lk === norm(k.add1)) {
        e.preventDefault(); addPoints(sel, 1 * sign); reset(); return;
      }
      if (lk === norm(k.add2)) {
        e.preventDefault(); addPoints(sel, 2 * sign); reset(); return;
      }
      if (lk === norm(k.add3)) {
        e.preventDefault(); addPoints(sel, 3 * sign); reset(); return;
      }
      if (lk === norm(k.senshu)) {
        if (isKata) return;
        e.preventDefault();
        setAdvantage(sel, !cur.undoArmed);
        reset();
        return;
      }
      if (lk === norm(k.penalty)) {
        if (isKata) return;
        e.preventDefault();
        addPenalty(sel, sign);
        reset();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, addPoints, setAdvantage, addPenalty, adjustTimer, togglePause, advanceActiveMatch, suppress, actionable]);

  // input-state hint banner
  const cur = inputRef.current;
  void tick;
  let content: React.ReactNode = "Waiting…";
  if (cur.selected) {
    const remaining = Math.max(
      0,
      Math.ceil((cur.expiresAt - Date.now()) / 1000)
    );
    content = (
      <>
        <span
          className={cur.selected === "red" ? "red-tag" : "blue-tag"}
        >
          {cur.selected === "red" ? "Red selected" : "Blue selected"}
        </span>{" "}
        {cur.undoArmed ? <span className="undo-tag">UNDO</span> : null}{" "}
        <span className="countdown">{remaining}s</span>
      </>
    );
  }

  return (
    <div className="input-state">
      <span className="label">INPUT:</span>
      {content}
    </div>
  );
}
