"use client";

import type {
  Discipline,
  PlayinTree,
  RRTree,
  SeriesTree,
  StandardTree,
  Subcategory,
} from "@karate/core";
import { roundLabel } from "@karate/core";
import { MatchNode } from "./match-node";

interface Props {
  sub: Subcategory;
  discipline: Discipline;
}

export function BracketRenderer({ sub, discipline }: Props) {
  const tree = sub.trees[discipline];
  if (!tree) return null;
  if (sub.type === "standard")
    return (
      <StandardBracket sub={sub} discipline={discipline} tree={tree as StandardTree} />
    );
  if (sub.type === "playin")
    return (
      <PlayinBlock sub={sub} discipline={discipline} tree={tree as PlayinTree} />
    );
  if (sub.type === "series")
    return (
      <SeriesBlock sub={sub} discipline={discipline} tree={tree as SeriesTree} />
    );
  if (sub.type === "roundrobin")
    return <RRBlock sub={sub} discipline={discipline} tree={tree as RRTree} />;
  return null;
}

function StandardBracket({
  sub,
  discipline,
  tree,
}: {
  sub: Subcategory;
  discipline: Discipline;
  tree: StandardTree;
}) {
  const total = tree.rounds.length;
  return (
    <div
      className="bracket-tree"
      style={{ minHeight: Math.max(280, tree.rounds[0].length * 110) }}
    >
      {tree.rounds.map((round, rIdx) => (
        <div key={rIdx} className="bracket-round">
          <div className="bracket-round-label">{roundLabel(rIdx, total)}</div>
          <div className="bracket-round-matches">
            {round.map((m, mIdx) => (
              <MatchNode
                key={mIdx}
                m={m}
                sub={sub}
                discipline={discipline}
                ref_={{
                  categoryId: sub.categoryId,
                  subcategoryId: sub.id,
                  discipline,
                  path: { kind: "std", round: rIdx, idx: mIdx },
                }}
              />
            ))}
          </div>
        </div>
      ))}
      {tree.thirdPlace != null && (
        <div className="bracket-round">
          <div className="bracket-round-label">3rd Place</div>
          <div className="bracket-round-matches">
            <MatchNode
              m={tree.thirdPlace}
              sub={sub}
              discipline={discipline}
              ref_={{
                categoryId: sub.categoryId,
                subcategoryId: sub.id,
                discipline,
                path: { kind: "3rd" },
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PlayinBlock({
  sub,
  discipline,
  tree,
}: {
  sub: Subcategory;
  discipline: Discipline;
  tree: PlayinTree;
}) {
  const total = tree.bracket.rounds.length;
  return (
    <div>
      <div className="special-block playin">
        <div className="special-block-title">⚡ Play-in Match</div>
        <div style={{ maxWidth: 260 }}>
          <MatchNode
            m={tree.extra}
            sub={sub}
            discipline={discipline}
            ref_={{
              categoryId: sub.categoryId,
              subcategoryId: sub.id,
              discipline,
              path: { kind: "playin" },
            }}
            label="Play-in"
          />
        </div>
      </div>
      <div
        className="bracket-tree"
        style={{
          minHeight: Math.max(280, tree.bracket.rounds[0].length * 110),
        }}
      >
        {tree.bracket.rounds.map((round, rIdx) => (
          <div key={rIdx} className="bracket-round">
            <div className="bracket-round-label">
              {roundLabel(rIdx, total)}
            </div>
            <div className="bracket-round-matches">
              {round.map((m, mIdx) => (
                <MatchNode
                  key={mIdx}
                  m={m}
                  sub={sub}
                  discipline={discipline}
                  ref_={{
                    categoryId: sub.categoryId,
                    subcategoryId: sub.id,
                    discipline,
                    path: { kind: "std", round: rIdx, idx: mIdx },
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        {tree.bracket.thirdPlace != null && (
          <div className="bracket-round">
            <div className="bracket-round-label">3rd Place</div>
            <div className="bracket-round-matches">
              <MatchNode
                m={tree.bracket.thirdPlace}
                sub={sub}
                discipline={discipline}
                ref_={{
                  categoryId: sub.categoryId,
                  subcategoryId: sub.id,
                  discipline,
                  path: { kind: "3rd" },
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SeriesBlock({
  sub,
  discipline,
  tree,
}: {
  sub: Subcategory;
  discipline: Discipline;
  tree: SeriesTree;
}) {
  return (
    <div className="special-block series">
      <div className="special-block-title">🔁 Best-of-2 Series</div>
      <div className="series-grid">
        {tree.matches.map((m, i) => (
          <MatchNode
            key={i}
            m={m}
            sub={sub}
            discipline={discipline}
            ref_={{
              categoryId: sub.categoryId,
              subcategoryId: sub.id,
              discipline,
              path: { kind: "series", idx: i },
            }}
            label={`Match ${i + 1}`}
          />
        ))}
      </div>
      {tree.winner ? (
        <div className="sub-winner-pill">
          🏆 Series winner: {tree.winner}
          {tree.juryDecided ? (
            <span style={{ opacity: 0.7 }}> (⚖️ jury)</span>
          ) : null}
        </div>
      ) : tree.matches.every((m) => m.winner) ? (
        <div style={{ marginTop: 12, color: "#888", fontSize: 12 }}>
          Awaiting tiebreaker computation…
        </div>
      ) : null}
    </div>
  );
}

function RRBlock({
  sub,
  discipline,
  tree,
}: {
  sub: Subcategory;
  discipline: Discipline;
  tree: RRTree;
}) {
  const labelMap: Record<string, string> = {
    ab: "A vs B",
    ac: "A vs C",
    bc: "B vs C",
  };
  return (
    <div className="special-block rr">
      <div className="special-block-title">🔄 Round Robin (3-way)</div>
      <div className="rr-grid">
        {tree.matches.map((m) => (
          <MatchNode
            key={m.pair}
            m={m}
            sub={sub}
            discipline={discipline}
            ref_={{
              categoryId: sub.categoryId,
              subcategoryId: sub.id,
              discipline,
              path: { kind: "rr", pair: m.pair! },
            }}
            label={labelMap[m.pair!]}
          />
        ))}
      </div>
      {tree.rankings ? (
        <table className="standings-table">
          <thead>
            <tr>
              <th>Competitor</th>
              <th className="num">W</th>
              <th className="num">L</th>
              <th className="num">Pts</th>
              <th className="num">Pen</th>
              <th className="num">Senshu</th>
            </tr>
          </thead>
          <tbody>
            {tree.rankings.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{r.w}</td>
                <td className="num">{r.l}</td>
                <td className="num">{r.pts}</td>
                <td className="num">{r.pen}</td>
                <td className="num">{r.senshu}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tree.winner ? (
        <div className="sub-winner-pill">
          🏆 Round-robin winner: {tree.winner}
          {tree.juryDecided ? (
            <span style={{ opacity: 0.7 }}> (⚖️ jury)</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
