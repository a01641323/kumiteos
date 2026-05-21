"use client";

import type { ActiveMatchRef, Discipline, Match, Subcategory } from "@karate/core";
import { samePath } from "@karate/core";
import { useStore } from "@/lib/store";

interface Props {
  m: Match;
  ref_: ActiveMatchRef;
  discipline: Discipline;
  sub: Subcategory;
  label?: string;
}

export function MatchNode({ m, ref_, discipline, sub, label }: Props) {
  const { state, loadMatch } = useStore();
  const showDiscTag = Object.keys(sub.trees).length > 1;
  const playable = !!(m.p1 && m.p2 && !m.winner);
  const active = state.match.activeMatchRef
    ? state.match.activeMatchRef.categoryId === ref_.categoryId &&
      state.match.activeMatchRef.subcategoryId === ref_.subcategoryId &&
      state.match.activeMatchRef.discipline === ref_.discipline &&
      samePath(state.match.activeMatchRef.path, ref_.path)
    : false;

  return (
    <div>
      {label ? <div className="match-node-label">{label}</div> : null}
      <div
        className={`match-node ${active ? "active" : ""} ${playable ? "" : "locked"}`}
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
