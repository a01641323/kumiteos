"use client";

import { useEffect, useState } from "react";
import type { AppState } from "@karate/core";

interface Props {
  state: AppState;
  subcategoryId: string;
}

type PaceTier = "ahead" | "ontime" | "warn" | "behind";

/**
 * Small pace-status chip rendered next to each running subcategory in the
 * admin sidebar. Reads engine state computed by runEngineTick (server-
 * side, broadcast on every action + 30 s heartbeat) AND recomputes the
 * delta locally on a 1 s ticker so the number is always live without
 * waiting on a server-side broadcast.
 *
 * Returns null when the subcategory has no live pace data yet (no
 * matches started).
 */
export function PaceBadge({ state, subcategoryId }: Props) {
  // Local 1 s ticker so the elapsed-since-start number updates without
  // the server having to re-broadcast on every wall-clock second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), 1000);
    return () => clearInterval(id);
  }, []);

  const runtime = state.engine?.subcategories?.[subcategoryId];
  if (!runtime || !runtime.actualStartTs) return null;

  // Find the live subcategory to read its total match count.
  let total = 0;
  let completed = 0;
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    const sub = cat.subcategories.find((s) => s.id === subcategoryId);
    if (!sub) continue;
    total = estimatedMatchCount(sub);
    break;
  }
  if (total <= 0) return null;

  const matches = state.engine?.matches ?? {};
  for (const m of Object.values(matches)) {
    if (m.ref.subcategoryId === subcategoryId && m.status === "COMPLETED") completed++;
  }

  const cfg = state.engine?.config;
  const avg = Math.max(1, cfg?.avgMatchDurationSeconds ?? 180);
  const expectedTotalSeconds = total * avg;
  const elapsedSeconds = (Date.now() - runtime.actualStartTs) / 1000;
  const progress = Math.min(1, completed / total);
  const pacedElapsed = progress * expectedTotalSeconds;
  const delta = Math.round(elapsedSeconds - pacedElapsed);

  const norm = delta / expectedTotalSeconds;
  let tier: PaceTier;
  if (norm < -0.10) tier = "ahead";
  else if (norm <= 0.10) tier = "ontime";
  else if (norm <= 0.25) tier = "warn";
  else tier = "behind";

  const abs = Math.abs(delta);
  const sign = delta < 0 ? "−" : "+";
  const mm = Math.floor(abs / 60).toString().padStart(2, "0");
  const ss = (abs % 60).toString().padStart(2, "0");

  return (
    <span className={`pace-badge tier-${tier}`} title={tierTooltip(tier)}>
      {sign}{mm}:{ss}
    </span>
  );
}

/** Same conservative estimator the LPT planner uses on the server side. */
function estimatedMatchCount(sub: { type: string; competitors: string[] }): number {
  const n = Math.max(sub.competitors.length, 1);
  switch (sub.type) {
    case "standard": return Math.max(1, n - 1) + (n >= 4 ? 1 : 0);
    case "playin":   return 1 + Math.max(1, (n - 1) - 1) + (n - 1 >= 4 ? 1 : 0);
    case "series":   return 3;
    case "roundrobin": return (n * (n - 1)) / 2;
    default: return n;
  }
}

function tierTooltip(tier: PaceTier): string {
  switch (tier) {
    case "ahead":  return "Ahead of expected pace";
    case "ontime": return "On expected pace";
    case "warn":   return "Slowing down — pace is slipping";
    case "behind": return "Behind expected pace — next match may be redirected";
  }
}
