"use client";

import { useState } from "react";
import { NumberField } from "./NumberField";
import {
  BELT_LABEL, BELT_ORDER, deriveCategoryName,
  type BeltColor, type CategoryDef,
} from "./types";

interface Props {
  value: CategoryDef[];
  onChange: (v: CategoryDef[]) => void;
  disabled?: boolean;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyRow(): CategoryDef {
  return { id: newId(), name: "", belts: ["white"], minAge: 6, maxAge: null, matchDurationSeconds: 120 };
}

function fmtMMSS(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StepCategories({ value, onChange, disabled }: Props) {
  const [draft, setDraft] = useState<CategoryDef>(() => emptyRow());

  function patchDraft<K extends keyof CategoryDef>(k: K, v: CategoryDef[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }
  function toggleBeltOnDraft(b: BeltColor) {
    setDraft((d) => {
      const has = d.belts.includes(b);
      // Keep them in canonical order for consistent auto-naming.
      const nextSet = new Set(d.belts);
      if (has) nextSet.delete(b); else nextSet.add(b);
      const next = BELT_ORDER.filter((c) => nextSet.has(c));
      return { ...d, belts: next };
    });
  }
  function selectAllBelts() {
    setDraft((d) => ({ ...d, belts: [...BELT_ORDER] }));
  }
  function clearAllBelts() {
    setDraft((d) => ({ ...d, belts: [] }));
  }

  const derivedName = deriveCategoryName(draft.belts, draft.minAge, draft.maxAge);

  function addDraft() {
    if (draft.belts.length === 0) return;
    onChange([...value, { ...draft, id: newId(), name: derivedName }]);
    setDraft(emptyRow());
  }

  function remove(id: string) {
    onChange(value.filter((c) => c.id !== id));
  }

  return (
    <div className="wizard-step">
      <p className="step-intro">
        Cada categoría agrupa competidores por edad y cinturones. El nombre
        se genera automáticamente — define al menos una.
      </p>

      {value.length === 0 ? (
        <p className="muted small">— ninguna definida todavía —</p>
      ) : (
        <table className="cat-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Cinturones</th>
              <th>Edad</th>
              <th>Duración</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {value.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted small">{c.belts.map((b) => BELT_LABEL[b]).join(", ")}</td>
                <td className="mono small">{c.minAge}{c.maxAge ? `–${c.maxAge}` : "+"}</td>
                <td className="mono small">{fmtMMSS(c.matchDurationSeconds ?? 120)}</td>
                <td style={{ textAlign: "right" }}>
                  {!disabled && (
                    <button type="button" className="btn-row" onClick={() => remove(c.id)}>Quitar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!disabled && (
        <div className="cat-form">
          <h4 className="section-meta" style={{ margin: "16px 0 8px" }}>AÑADIR CATEGORÍA</h4>

          <div
            className="field"
            style={{
              padding: "10px 12px",
              background: "color-mix(in oklab, var(--color-accent) 8%, transparent)",
              border: "1px solid color-mix(in oklab, var(--color-accent) 30%, transparent)",
            }}
          >
            <span className="muted small mono" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Se guardará como
            </span>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{derivedName}</div>
          </div>

          <div className="field">
            <span className="field-label" style={{ marginBottom: 6 }}>Cinturones</span>
            <div className="belt-grid">
              <button
                type="button"
                className="belt-chip belt-action"
                onClick={selectAllBelts}
              >
                Todas
              </button>
              <button
                type="button"
                className="belt-chip belt-action"
                onClick={clearAllBelts}
              >
                Limpiar
              </button>
              {BELT_ORDER.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`belt-chip belt-${b} ${draft.belts.includes(b) ? "active" : ""}`}
                  onClick={() => toggleBeltOnDraft(b)}
                >
                  {BELT_LABEL[b]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <label className="field">
              <span className="field-label">Edad mínima</span>
              <NumberField
                value={draft.minAge}
                defaultValue={6}
                min={3} max={99}
                onChange={(v) => patchDraft("minAge", v)}
                aria-label="Edad mínima"
              />
            </label>
            <label className="field">
              <span className="field-label">Edad máxima (vacío = sin tope)</span>
              <NumberField
                value={draft.maxAge ?? 0}
                defaultValue={0}
                min={3} max={99}
                allowNull
                onNull={() => patchDraft("maxAge", null)}
                onChange={(v) => patchDraft("maxAge", v)}
                aria-label="Edad máxima"
              />
            </label>
            <label className="field">
              <span className="field-label">Duración del combate (seg)</span>
              <NumberField
                value={draft.matchDurationSeconds ?? 120}
                defaultValue={120}
                min={10} max={600}
                onChange={(v) => patchDraft("matchDurationSeconds", v)}
                aria-label="Duración del combate en segundos"
              />
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn primary"
              onClick={addDraft}
              disabled={draft.belts.length === 0}
            >
              Añadir categoría
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
