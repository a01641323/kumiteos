"use client";

// =============================================================
// Next-Match Notification Panel (#private view, top-right).
//
// Reads `state.engine.nextMatchPerArea` (server-computed, broadcast to
// every client) and renders one card per area this machine is assigned
// to. Status tags update live; the "Resting" countdown ticks each second
// from `competitor.lastMatchEndTs + minRest`.
// =============================================================

import { useEffect, useState } from "react";
import type { AppState, ActiveMatchRef } from "@karate/core";
import { refFromMatchId } from "@karate/core";
import { useArea } from "@/lib/area-context";
import { useStore } from "@/lib/store";

type StatusTag = "Ready" | "Resting" | "Waiting" | "Interleaved";

interface PanelData {
  areaIndex: number;
  areaName: string;
  matchRef: ActiveMatchRef | null;
  matchId: string | null;
  subcategoryLabel: string;
  discipline: "KATA" | "COMBAT" | null;
  blueName: string | null;
  redName: string | null;
  status: StatusTag | "Empty";
  /** Remaining rest in seconds (when status === "Resting"). */
  restRemainingSec: number;
  /** Subcategory paused for this interleaved match. */
  interleavedFrom: string | null;
}

function resolvePanelForArea(state: AppState, areaIndex: number, now: number): PanelData {
  const eng = state.engine;
  const areaName = `Area ${areaIndex + 1}`;
  const empty: PanelData = {
    areaIndex,
    areaName,
    matchRef: null,
    matchId: null,
    subcategoryLabel: "",
    discipline: null,
    blueName: null,
    redName: null,
    status: "Empty",
    restRemainingSec: 0,
    interleavedFrom: null,
  };
  if (!eng) return empty;
  const hint = eng.nextMatchPerArea?.[areaIndex];
  if (!hint) return empty;
  const ref = refFromMatchId(hint.matchId);
  if (!ref) return empty;
  const runtime = eng.matches?.[hint.matchId];
  if (!runtime) return empty;

  // Look up the bracket match for competitor names.
  const sub = state.tournament.categories[ref.categoryId]?.subcategories.find((s) => s.id === ref.subcategoryId);
  const subLabel = sub?.label ?? "";
  let p1: string | null = null;
  let p2: string | null = null;
  const tree = sub?.trees[ref.discipline] as unknown as {
    rounds?: Array<Array<{ p1: string | null; p2: string | null }>>;
    bracket?: { rounds: Array<Array<{ p1: string | null; p2: string | null }>> };
    extra?: { p1: string | null; p2: string | null };
    matches?: Array<{ p1: string | null; p2: string | null; pair?: string }>;
    thirdPlace?: { p1: string | null; p2: string | null };
  } | undefined;
  if (tree) {
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
      const pair = ref.path.pair;
      const m = tree.matches?.find((mm) => mm.pair === pair);
      if (m) { p1 = m.p1; p2 = m.p2; }
    } else if (ref.path.kind === "3rd") {
      if (tree.thirdPlace) { p1 = tree.thirdPlace.p1; p2 = tree.thirdPlace.p2; }
    }
  }

  // Compute status from runtime + competitor rest timers.
  let status: StatusTag = "Ready";
  let restRemaining = 0;
  if (!p1 || !p2) {
    status = "Waiting";
  } else {
    const cA = eng.competitors?.[p1];
    const cB = eng.competitors?.[p2];
    const minRestMs = (eng.config?.minRestSeconds ?? 120) * 1000;
    let maxRest = 0;
    for (const c of [cA, cB]) {
      if (!c) continue;
      if (c.lastMatchEndTs) {
        const remaining = c.lastMatchEndTs + minRestMs - now;
        if (remaining > maxRest) maxRest = remaining;
      }
    }
    if (maxRest > 0) {
      status = "Resting";
      restRemaining = Math.ceil(maxRest / 1000);
    } else if (hint.isInterleaved) {
      status = "Interleaved";
    } else {
      status = "Ready";
    }
  }

  // Look up the interleaved-from subcategory label.
  let interleavedFrom: string | null = null;
  if (hint.isInterleaved && hint.primarySubcategoryId) {
    for (const catId of state.tournament.categoryOrder) {
      const cat = state.tournament.categories[catId];
      if (!cat) continue;
      const ps = cat.subcategories.find((s) => s.id === hint.primarySubcategoryId);
      if (ps) { interleavedFrom = ps.label; break; }
    }
  }

  return {
    areaIndex,
    areaName,
    matchRef: ref,
    matchId: hint.matchId,
    subcategoryLabel: subLabel,
    discipline: runtime.bracketTree,
    blueName: p1,
    redName: p2,
    status,
    restRemainingSec: restRemaining,
    interleavedFrom,
  };
}

const STATUS_COLORS: Record<StatusTag | "Empty", string> = {
  Ready: "#16a34a",         // green
  Resting: "#ca8a04",       // yellow
  Waiting: "#6b7280",       // gray
  Interleaved: "#ea580c",   // orange
  Empty: "#6b7280",
};

function StatusBadge({ status, restSec }: { status: StatusTag | "Empty"; restSec: number }) {
  const color = STATUS_COLORS[status];
  let label: string;
  if (status === "Resting") label = `Resting: ${restSec}s`;
  else if (status === "Waiting") label = "Waiting for result";
  else label = status;
  return (
    <div
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: color,
        color: "white",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.5,
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

function PanelCard({ data }: { data: PanelData }) {
  const isEmpty = data.status === "Empty";
  return (
    <div
      style={{
        width: 280,
        background: "rgba(15, 23, 42, 0.92)",
        color: "#e2e8f0",
        border: "1px solid rgba(148, 163, 184, 0.2)",
        borderRadius: 8,
        padding: 12,
        boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
        fontSize: 13,
        lineHeight: 1.4,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#94a3b8", textTransform: "uppercase" }}>
          Next Match · {data.areaName}
        </span>
        {data.discipline ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
              padding: "1px 6px",
              borderRadius: 3,
              background: data.discipline === "KATA" ? "#7c3aed" : "#dc2626",
              color: "white",
            }}
          >
            {data.discipline}
          </span>
        ) : null}
      </div>
      {isEmpty ? (
        <div style={{ color: "#94a3b8", fontStyle: "italic", marginTop: 4 }}>
          No matches pending
        </div>
      ) : (
        <>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#f8fafc" }}>
            {data.subcategoryLabel || "—"}
          </div>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: "#3b82f6", marginRight: 6 }}>●</span>
            {data.blueName || "—"}
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: "#ef4444", marginRight: 6 }}>●</span>
            {data.redName || "—"}
          </div>
          <StatusBadge status={data.status} restSec={data.restRemainingSec} />
          {data.status === "Interleaved" && data.interleavedFrom ? (
            <div style={{ marginTop: 6, fontSize: 11, color: "#cbd5e1" }}>
              Filling rest gap for: <em>{data.interleavedFrom}</em>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function NextMatchPanel() {
  const { state } = useStore();
  const { current } = useArea();
  // Live ticker so the rest countdown re-renders every second.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), 1000);
    return () => clearInterval(id);
  }, []);

  // Which areas does this machine display? If `useArea` returns null we
  // assume the operator has not picked one yet — show nothing rather than
  // every area's next match.
  if (current === null) return null;
  const now = Date.now() + tick * 0; // keep `tick` in dep tree via the closure
  const data = resolvePanelForArea(state, current, Date.now());
  void now;

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        right: 16,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <PanelCard data={data} />
    </div>
  );
}
