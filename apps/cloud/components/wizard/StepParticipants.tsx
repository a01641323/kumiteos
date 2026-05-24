"use client";

import { useRef, useState } from "react";
import { BELT_ALIASES, BELT_LABEL, BELT_ORDER, type BeltColor, type ParticipantRow } from "./types";

interface Props {
  value: ParticipantRow[];
  onChange: (v: ParticipantRow[]) => void;
  disabled?: boolean;
}

type Tab = "csv" | "manual";

const SAMPLE = `nombre,apellido,beltColor,age
Juan,Pérez,blanco,12
María,González,naranja,14
Luis,Ramírez,negro,28`;

export function StepParticipants({ value, onChange, disabled }: Props) {
  const [tab, setTab] = useState<Tab>("manual");
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState<ParticipantRow>({
    nombre: "", apellido: "", beltColor: "white", age: 12, arrived: false,
  });

  function patchDraft<K extends keyof ParticipantRow>(k: K, v: ParticipantRow[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }
  function addDraft() {
    if (!draft.nombre.trim() || !draft.apellido.trim()) return;
    onChange([...value, { ...draft, arrived: false }]);
    setDraft({ nombre: "", apellido: "", beltColor: draft.beltColor, age: draft.age, arrived: false });
  }
  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function clearAll() {
    if (!confirm(`¿Quitar los ${value.length} competidores?`)) return;
    onChange([]);
  }

  async function importText(text: string, mode: "append" | "replace") {
    const { rows, errs } = parseCsv(text);
    setErrors(errs);
    if (rows.length === 0) return;
    onChange(mode === "replace" ? rows : [...value, ...rows]);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const text = await f.text();
    const replace = value.length > 0 && confirm(`Ya hay ${value.length} competidores. ¿Reemplazar (Aceptar) o agregar al final (Cancelar)?`);
    importText(text, replace ? "replace" : "append");
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "competidores-ejemplo.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="wizard-step">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <p className="step-intro" style={{ margin: 0 }}>
          Carga competidores desde un CSV o agrégalos a mano. Mínimo 1.
        </p>
        <span className="section-meta">{value.length} CARGADOS</span>
      </div>

      <div className="seg-group" style={{ marginTop: 16 }}>
        <button type="button" className={`seg ${tab === "manual" ? "active" : ""}`} onClick={() => setTab("manual")}>
          <strong>Manual</strong>
          <span className="muted small">Uno por uno</span>
        </button>
        <button type="button" className={`seg ${tab === "csv" ? "active" : ""}`} onClick={() => setTab("csv")}>
          <strong>CSV</strong>
          <span className="muted small">Importar archivo</span>
        </button>
      </div>

      {tab === "manual" && !disabled && (
        <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 140px 80px auto" }}>
          <input
            className="field-input"
            placeholder="Nombre"
            value={draft.nombre}
            onChange={(e) => patchDraft("nombre", e.target.value)}
          />
          <input
            className="field-input"
            placeholder="Apellido"
            value={draft.apellido}
            onChange={(e) => patchDraft("apellido", e.target.value)}
          />
          <select
            className="field-input"
            value={draft.beltColor}
            onChange={(e) => patchDraft("beltColor", e.target.value as BeltColor)}
          >
            {BELT_ORDER.map((b) => <option key={b} value={b}>{BELT_LABEL[b]}</option>)}
          </select>
          <input
            type="number"
            min={3} max={99}
            className="field-input"
            value={draft.age}
            onChange={(e) => patchDraft("age", parseInt(e.target.value || "0", 10))}
          />
          <button type="button" className="btn primary" onClick={addDraft}>Añadir</button>
        </div>
      )}

      {tab === "csv" && !disabled && (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              style={{ display: "none" }}
            />
            <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
              Subir archivo CSV
            </button>
            <button type="button" className="btn ghost" onClick={downloadSample}>
              Descargar plantilla
            </button>
          </div>
          <p className="muted small">
            Formato: columnas <code>nombre, apellido, beltColor, age</code>.
            Acepta nombres de cinta en español (blanco, naranja, marrón…).
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="error-banner" style={{ marginTop: 16 }}>
          <strong>{errors.length} errores en el CSV:</strong>
          <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
            {errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
            {errors.length > 6 && <li className="muted">… y {errors.length - 6} más</li>}
          </ul>
        </div>
      )}

      {value.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <h4 className="section-meta" style={{ margin: 0 }}>COMPETIDORES CARGADOS</h4>
            {!disabled && value.length > 0 && (
              <button type="button" className="btn-row danger" onClick={clearAll}>Quitar todos</button>
            )}
          </div>
          <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--color-line)", borderRadius: 4 }}>
            <table className="cat-table" style={{ margin: 0 }}>
              <thead>
                <tr><th>Nombre</th><th>Apellido</th><th>Cinta</th><th>Edad</th><th></th></tr>
              </thead>
              <tbody>
                {value.map((p, i) => (
                  <tr key={i}>
                    <td>{p.nombre}</td>
                    <td>{p.apellido}</td>
                    <td className="muted small">{BELT_LABEL[p.beltColor] ?? p.beltColor}</td>
                    <td className="mono small">{p.age}</td>
                    <td style={{ textAlign: "right" }}>
                      {!disabled && (
                        <button type="button" className="btn-row" onClick={() => removeAt(i)}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function parseCsv(text: string): { rows: ParticipantRow[]; errs: string[] } {
  const rows: ParticipantRow[] = [];
  const errs: string[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { rows, errs: ["Archivo vacío"] };
  const header = splitLine(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const idx = {
    nombre: header.indexOf("nombre"),
    apellido: header.indexOf("apellido"),
    beltColor: header.indexOf("beltcolor"),
    age: header.indexOf("age"),
  };
  for (const k of ["nombre", "apellido", "beltColor", "age"] as const) {
    if (idx[k] < 0) errs.push(`Falta columna requerida: ${k}`);
  }
  if (errs.length > 0) return { rows, errs };

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cols = splitLine(raw);
    const nombre = (cols[idx.nombre] ?? "").trim();
    const apellido = (cols[idx.apellido] ?? "").trim();
    const beltRaw = (cols[idx.beltColor] ?? "").trim().toLowerCase();
    const ageRaw = (cols[idx.age] ?? "").trim();
    if (!nombre || !apellido) { errs.push(`Línea ${i + 1}: nombre y apellido son requeridos`); continue; }
    const belt = BELT_ALIASES[beltRaw];
    if (!belt) { errs.push(`Línea ${i + 1}: cinta desconocida "${beltRaw}"`); continue; }
    const age = Number.parseInt(ageRaw, 10);
    if (!Number.isFinite(age) || age < 3 || age > 99) { errs.push(`Línea ${i + 1}: edad inválida "${ageRaw}"`); continue; }
    rows.push({ nombre, apellido, beltColor: belt, age, arrived: false });
  }
  return { rows, errs };
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", i = 0, q = false;
  while (i < line.length) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { out.push(cur); cur = ""; i++; continue; }
    cur += c; i++;
  }
  out.push(cur);
  return out;
}
