"use client";

import type { BundleSettings } from "./types";

interface Props {
  value: BundleSettings;
  onChange: (v: BundleSettings) => void;
  disabled?: boolean;
}

const SUBCAT_SIZES: BundleSettings["subcategorySize"][] = [4, 8, 16];
const MODES: { v: BundleSettings["disciplineMode"]; label: string; sub: string }[] = [
  { v: "combat", label: "Combate", sub: "Solo kumite" },
  { v: "kata",   label: "Kata",    sub: "Solo formas" },
  { v: "both",   label: "Ambos",   sub: "Combate y kata" },
];

export function StepSettings({ value, onChange, disabled }: Props) {
  function set<K extends keyof BundleSettings>(k: K, v: BundleSettings[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="wizard-step">
      <p className="step-intro">
        Configuración global del torneo. Puedes cambiarla antes de enviar la
        solicitud, pero no después de activar el código.
      </p>

      <label className="field">
        <span className="field-label">Número de áreas (1–6)</span>
        <input
          type="number"
          min={1}
          max={6}
          value={value.areaCount}
          onChange={(e) => set("areaCount", clamp(parseInt(e.target.value || "1", 10), 1, 6))}
          className="field-input"
          disabled={disabled}
        />
        <span className="field-hint">
          Cada área corre su propio scoreboard. Más áreas = torneo más rápido pero
          requiere más mesas de control.
        </span>
      </label>

      <div className="field">
        <span className="field-label">Disciplina</span>
        <div className="seg-group">
          {MODES.map((m) => (
            <button
              key={m.v}
              type="button"
              disabled={disabled}
              className={`seg ${value.disciplineMode === m.v ? "active" : ""}`}
              onClick={() => set("disciplineMode", m.v)}
            >
              <strong>{m.label}</strong>
              <span className="muted small">{m.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Tamaño de subcategoría</span>
        <div className="seg-group">
          {SUBCAT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              className={`seg ${value.subcategorySize === s ? "active" : ""}`}
              onClick={() => set("subcategorySize", s)}
            >
              <strong>{s}</strong>
              <span className="muted small">competidores / llave</span>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">Diferencia de puntos para victoria automática</span>
        <input
          type="number"
          min={0}
          max={20}
          value={value.pointDifference ?? 8}
          onChange={(e) => set("pointDifference", clamp(parseInt(e.target.value || "0", 10), 0, 20))}
          className="field-input"
          disabled={disabled}
        />
        <span className="field-hint">0 = desactivado. Estándar mundial: 8 puntos.</span>
      </label>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
