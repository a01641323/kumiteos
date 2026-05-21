"use client";

import { useState } from "react";
import type { DisciplineMode, SubcategorySize } from "@karate/core";
import { buildAreaPlan } from "@karate/core";
import { useStore } from "@/lib/store";

const SIZES: SubcategorySize[] = [4, 8, 16];
const MODES: { value: DisciplineMode; label: string }[] = [
  { value: "combat", label: "Combat only" },
  { value: "kata", label: "Kata only" },
  { value: "both", label: "Both" },
];

export function SetupSection() {
  const {
    state,
    applyTournamentSettings,
    setAreaCount,
    assignSubcategoryToArea,
  } = useStore();
  const settings = state.tournament.settings;
  const [size, setSize] = useState<SubcategorySize>(settings.subcategorySize);
  const [mode, setMode] = useState<DisciplineMode>(settings.disciplineMode);
  const [pointDiff, setPointDiff] = useState<number>(settings.pointDifference ?? 8);
  const [areasOpen, setAreasOpen] = useState(false);
  const dirty =
    size !== settings.subcategorySize ||
    mode !== settings.disciplineMode ||
    pointDiff !== (settings.pointDifference ?? 8);

  function applySettings() {
    applyTournamentSettings(size, mode, pointDiff);
  }

  return (
    <section className="super-section">
      <h2>Tournament setup</h2>
      <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
        <div>
          <div className="muted small">Group size</div>
          {SIZES.map((s) => (
            <label key={s} style={{ marginRight: 12 }}>
              <input
                type="radio"
                checked={size === s}
                onChange={() => setSize(s)}
              />{" "}
              {s}
            </label>
          ))}
        </div>
        <div>
          <div className="muted small">Discipline</div>
          {MODES.map((m) => (
            <label key={m.value} style={{ marginRight: 12 }}>
              <input
                type="radio"
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
              />{" "}
              {m.label}
            </label>
          ))}
        </div>
        <div>
          <div className="muted small">Point-difference auto-finish</div>
          <input
            type="number"
            min={0}
            max={20}
            value={pointDiff}
            onChange={(e) => setPointDiff(Number(e.target.value) || 0)}
            style={{ width: 80 }}
          />
          <span className="muted small">  (0 = disabled)</span>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="primary"
          disabled={!dirty}
          onClick={applySettings}
        >
          Apply settings
        </button>
      </div>

      <hr style={{ borderColor: "var(--border, #2a3142)", margin: "20px 0" }} />

      <div className="row" style={{ alignItems: "center" }}>
        <div>
          <div className="muted small">Number of competition areas</div>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.areaCount}
            onChange={(e) => {
              const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
              setAreaCount(n);
            }}
            style={{ width: 80 }}
          />
        </div>
        <button className="right" onClick={() => setAreasOpen((o) => !o)}>
          {areasOpen ? "Hide" : "View"} area assignments
        </button>
      </div>

      {areasOpen ? (
        <AreaAssignmentsView
          onAssign={(subId, areaIdx) => assignSubcategoryToArea(subId, areaIdx)}
        />
      ) : null}
    </section>
  );
}

function AreaAssignmentsView({
  onAssign,
}: {
  onAssign: (subcategoryId: string, areaIndex: number) => void;
}) {
  const { state } = useStore();
  const { areas } = buildAreaPlan(
    {
      categoryOrder: state.tournament.categoryOrder,
      categories: state.tournament.categories,
      areaCount: state.tournament.settings.areaCount,
    },
    state.tournament.areaAssignments
  );

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
      {areas.map((a) => (
        <div key={a.index} style={{
          border: "1px solid var(--border, #2a3142)",
          borderRadius: 8,
          padding: 12,
          background: "var(--panel-2, #1d2230)",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {a.label} <span className="muted small">· {a.subcategoryIds.length} subcategories</span>
          </div>
          {a.subcategoryIds.length === 0 ? (
            <div className="muted small">(empty)</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}>
              {a.subcategoryIds.map((subId) => {
                const owner = findSubcategory(state, subId);
                if (!owner) return null;
                return (
                  <li key={subId} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "3px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}>
                    <span>{owner.cat.name} · {owner.sub.label}</span>
                    <select
                      value={a.index}
                      onChange={(e) => onAssign(subId, Number(e.target.value))}
                      style={{ fontSize: 11, padding: "1px 4px" }}
                    >
                      {areas.map((other) => (
                        <option key={other.index} value={other.index}>
                          {other.label}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function findSubcategory(
  state: ReturnType<typeof useStore>["state"],
  subId: string
) {
  for (const catId of state.tournament.categoryOrder) {
    const cat = state.tournament.categories[catId];
    if (!cat) continue;
    const sub = cat.subcategories.find((s) => s.id === subId);
    if (sub) return { cat, sub };
  }
  return null;
}
