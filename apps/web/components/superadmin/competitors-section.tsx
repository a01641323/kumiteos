"use client";

import { useMemo, useRef, useState } from "react";
import type { BeltColor, CategoryDef, Participant } from "@karate/core";
import {
  BELT_LABEL_EN,
  BELT_ORDER,
  describeCategoryDef,
  findCategoryForParticipant,
  parseParticipantsCsv,
  stringifyParticipantsCsv,
} from "@karate/core";
import { useStore } from "@/lib/store";

interface ParticipantRow extends Participant {
  matchedCategoryName: string | null;
}

export function CompetitorsSection() {
  const {
    state,
    addParticipant,
    removeParticipant,
    replaceParticipants,
  } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filterCatId, setFilterCatId] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = useMemo<ParticipantRow[]>(() => {
    const defs = state.tournament.categoryDefs;
    return state.tournament.participants.map((p) => {
      const def = findCategoryForParticipant(defs, p);
      return { ...p, matchedCategoryName: def?.name ?? null };
    });
  }, [state.tournament.participants, state.tournament.categoryDefs]);

  const visible = filterCatId
    ? filterCatId === "__unassigned__"
      ? rows.filter((r) => r.matchedCategoryName === null)
      : rows.filter(
          (r) =>
            findCategoryForParticipant(
              state.tournament.categoryDefs.filter((d) => d.id === filterCatId),
              r
            )?.id === filterCatId
        )
    : rows;

  function downloadCsv() {
    const csv = stringifyParticipantsCsv(state.tournament.participants);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `karate-participants-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const result = parseParticipantsCsv(text);
      if (result.errors.length > 0) {
        setFeedback(
          `Imported ${result.participants.length} rows; skipped ${result.errors.length} (${result.errors[0]?.message})`
        );
      } else {
        setFeedback(`Imported ${result.participants.length} participants.`);
      }
      replaceParticipants(result.participants);
    };
    reader.readAsText(file);
  }

  return (
    <section className="super-section">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Competitors</h2>
        <span className="muted">
          {state.tournament.participants.length} total ·{" "}
          {rows.filter((r) => r.matchedCategoryName === null).length} unassigned
        </span>
        <span className="right" />
        <button onClick={() => fileRef.current?.click()}>Import CSV…</button>
        <button onClick={downloadCsv}>Export CSV</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadCsv(f);
            e.target.value = "";
          }}
        />
      </div>
      {feedback ? <div className="muted small">{feedback}</div> : null}
      <AddCompetitorRow
        defs={state.tournament.categoryDefs}
        onAdd={(p) => addParticipant(p)}
      />
      <div style={{ marginTop: 16, marginBottom: 8 }}>
        <label className="muted small">Filter:&nbsp;</label>
        <select
          value={filterCatId}
          onChange={(e) => setFilterCatId(e.target.value)}
        >
          <option value="">All categories</option>
          {state.tournament.categoryDefs.map((d) => (
            <option key={d.id} value={d.id}>
              {describeCategoryDef(d)}
            </option>
          ))}
          <option value="__unassigned__">⚠ Unassigned</option>
        </select>
      </div>
      <div style={{ maxHeight: 380, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Surname</th>
              <th>Belt</th>
              <th>Age</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <tr key={p.id}>
                <td>{i + 1}</td>
                <td>{p.nombre}</td>
                <td>{p.apellido}</td>
                <td>{BELT_LABEL_EN[p.beltColor]}</td>
                <td>{p.age}</td>
                <td className={p.matchedCategoryName ? "" : "muted"}>
                  {p.matchedCategoryName ?? "Unassigned"}
                </td>
                <td className="right">
                  <button onClick={() => removeParticipant(p.id)}>Remove</button>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr><td colSpan={7} className="muted">No competitors match this filter.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AddCompetitorRow({
  defs: _defs,
  onAdd,
}: {
  defs: CategoryDef[];
  onAdd: (p: Omit<Participant, "id">) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [age, setAge] = useState(10);
  const [belt, setBelt] = useState<BeltColor>("white");
  return (
    <div className="row" style={{ gap: 6, marginTop: 8 }}>
      <input
        type="text"
        placeholder="Name"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />
      <input
        type="text"
        placeholder="Surname"
        value={apellido}
        onChange={(e) => setApellido(e.target.value)}
      />
      <select value={belt} onChange={(e) => setBelt(e.target.value as BeltColor)}>
        {BELT_ORDER.map((b) => (
          <option key={b} value={b}>
            {BELT_LABEL_EN[b]}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={3}
        max={99}
        value={age}
        onChange={(e) => setAge(Number(e.target.value) || 0)}
        style={{ width: 80 }}
      />
      <button
        className="primary"
        onClick={() => {
          if (!nombre.trim() || !apellido.trim()) return;
          onAdd({ nombre: nombre.trim(), apellido: apellido.trim(), beltColor: belt, age });
          setNombre("");
          setApellido("");
        }}
      >
        Add competitor
      </button>
    </div>
  );
}
