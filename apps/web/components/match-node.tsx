"use client";

import type { ActiveMatchRef, Discipline, Match, Subcategory } from "@karate/core";
import { samePath, matchIdFromRef } from "@karate/core";
import { useStore } from "@/lib/store";
import { useArea } from "@/lib/area-context";

interface Props {
  m: Match;
  ref_: ActiveMatchRef;
  discipline: Discipline;
  sub: Subcategory;
  label?: string;
}

export function MatchNode({ m, ref_, discipline, sub, label }: Props) {
  const { state, loadMatch } = useStore();
  const { current: areaIdx } = useArea();
  const showDiscTag = Object.keys(sub.trees).length > 1;
  const active = state.match.activeMatchRef
    ? state.match.activeMatchRef.categoryId === ref_.categoryId &&
      state.match.activeMatchRef.subcategoryId === ref_.subcategoryId &&
      state.match.activeMatchRef.discipline === ref_.discipline &&
      samePath(state.match.activeMatchRef.path, ref_.path)
    : false;
  // Reservation: if this match is queued as the "next match" for some
  // OTHER area, no one outside that area can grab it. The reserving
  // area's own operator can still load it.
  const myMid = matchIdFromRef(ref_);
  const npa = state.engine?.nextMatchPerArea ?? {};
  let reservedFor: number | null = null;
  for (const k of Object.keys(npa)) {
    const ai = Number(k);
    if (npa[ai]?.matchId === myMid) { reservedFor = ai; break; }
  }
  const reservedElsewhere =
    reservedFor !== null && areaIdx !== null && reservedFor !== areaIdx;
  const playable = !!(m.p1 && m.p2 && !m.winner) && !reservedElsewhere;

  return (
    <div>
      {label ? <div className="match-node-label">{label}</div> : null}
      <div
        className={`match-node ${active ? "active" : ""} ${playable ? "" : "locked"} ${reservedElsewhere ? "reserved" : ""}`}
        title={reservedElsewhere ? `Reserved as next match for Area ${(reservedFor ?? 0) + 1}` : undefined}
        onClick={playable ? () => loadMatch(ref_) : undefined}
      >
        {showDiscTag ? (
          <div className={`disc-tag ${discipline}`}>
            {discipline === "kata" ? "K" : "C"}
          </div>
        ) : null}
        <CompetitorRow m={m} which="p1" />
        <CompetitorRow m={m} which="p2" />
      </div>
    </div>
  );
}

function CompetitorRow({ m, which }: { m: Match; which: "p1" | "p2" }) {
  const name = m[which];
  if (!name) {
    if (m.p1 && which === "p2" && !m.p2) {
      return <div className="competitor bye">BYE</div>;
    }
    return <div className="competitor empty">— TBD —</div>;
  }
  const cls = ["competitor"];
  if (m.winner === name) cls.push("winner");
  if (m.eliminated === name || (m.winner && m.winner !== name)) cls.push("lost");
  return (
    <div className={cls.join(" ")}>
      {name}
      {m.winner === name && m.jury ? (
        <span style={{ fontSize: 11, opacity: 0.7 }}> ⚖️</span>
      ) : null}
    </div>
  );
}
