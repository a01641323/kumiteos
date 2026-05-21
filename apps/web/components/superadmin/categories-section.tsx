"use client";

import { useState } from "react";
import type { BeltColor, CategoryDef } from "@karate/core";
import { BELT_LABEL_EN, BELT_ORDER, newCategoryDefId } from "@karate/core";
import { useStore } from "@/lib/store";

const ALL_BELTS: BeltColor[] = [...BELT_ORDER];

export function CategoriesSection() {
  const { state, addCategoryDef, updateCategoryDef, removeCategoryDef } = useStore();
  const [adding, setAdding] = useState(false);

  return (
    <section className="super-section">
      <div className="row">
        <h2 style={{ margin: 0 }}>Categories</h2>
        <button className="primary right" onClick={() => setAdding(true)}>
          + Add category
        </button>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Each category accepts a set of belt colors and an age range. Participants
        are matched to the first category whose criteria they satisfy.
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ width: "30%" }}>Name</th>
            <th>Belts</th>
            <th>Min age</th>
            <th>Max age</th>
            <th>Matched competitors</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {state.tournament.categoryDefs.map((def) => (
            <CategoryRow
              key={def.id}
              def={def}
              competitors={state.tournament.categories[def.id]?.competitors.length ?? 0}
              onChange={updateCategoryDef}
              onDelete={() => removeCategoryDef(def.id)}
            />
          ))}
          {state.tournament.categoryDefs.length === 0 ? (
            <tr><td colSpan={6} className="muted">No categories yet — add one to get started.</td></tr>
          ) : null}
        </tbody>
      </table>
      {adding ? (
        <AddCategoryRow
          onCancel={() => setAdding(false)}
          onSubmit={(def) => {
            addCategoryDef(def);
            setAdding(false);
          }}
        />
      ) : null}
    </section>
  );
}

function CategoryRow({
  def,
  competitors,
  onChange,
  onDelete,
}: {
  def: CategoryDef;
  competitors: number;
  onChange: (def: CategoryDef) => void;
  onDelete: () => void;
}) {
  return (
    <tr>
      <td>
        <input
          type="text"
          value={def.name}
          onChange={(e) => onChange({ ...def, name: e.target.value })}
        />
      </td>
      <td>
        <BeltMultiSelect
          value={def.belts}
          onChange={(belts) => onChange({ ...def, belts })}
        />
      </td>
      <td>
        <input
          type="number"
          min={3}
          max={99}
          value={def.minAge}
          style={{ width: 70 }}
          onChange={(e) => onChange({ ...def, minAge: Number(e.target.value) || 0 })}
        />
      </td>
      <td>
        <input
          type="number"
          min={0}
          max={99}
          placeholder="—"
          value={def.maxAge ?? ""}
          style={{ width: 70 }}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({
              ...def,
              maxAge: raw === "" ? null : Number(raw),
            });
          }}
        />
      </td>
      <td>{competitors}</td>
      <td className="right">
        <button className="danger" onClick={onDelete}>Delete</button>
      </td>
    </tr>
  );
}

function AddCategoryRow({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (def: CategoryDef) => void;
}) {
  const [name, setName] = useState("");
  const [belts, setBelts] = useState<BeltColor[]>([]);
  const [minAge, setMinAge] = useState(4);
  const [maxAge, setMaxAge] = useState<number | null>(99);

  return (
    <div className="row" style={{ marginTop: 16, gap: 8 }}>
      <input
        type="text"
        placeholder="Name (e.g., Yellow 4-6)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <BeltMultiSelect value={belts} onChange={setBelts} />
      <input
        type="number"
        min={3}
        max={99}
        value={minAge}
        style={{ width: 80 }}
        onChange={(e) => setMinAge(Number(e.target.value) || 0)}
      />
      <input
        type="number"
        min={0}
        max={99}
        placeholder="∞"
        value={maxAge ?? ""}
        style={{ width: 80 }}
        onChange={(e) => {
          const raw = e.target.value;
          setMaxAge(raw === "" ? null : Number(raw));
        }}
      />
      <button
        className="primary"
        onClick={() => {
          if (!name.trim()) return;
          onSubmit({
            id: newCategoryDefId(),
            name: name.trim(),
            belts,
            minAge,
            maxAge,
          });
        }}
      >
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

function BeltMultiSelect({
  value,
  onChange,
}: {
  value: BeltColor[];
  onChange: (next: BeltColor[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {ALL_BELTS.map((b) => {
        const on = value.includes(b);
        return (
          <button
            key={b}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== b) : [...value, b])}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 999,
              border: on ? "1px solid var(--accent, #4f8cff)" : "1px solid var(--border, #2a3142)",
              background: on ? "rgba(79,140,255,0.15)" : "var(--panel-2, #1d2230)",
              color: on ? "var(--text, #e6ebf2)" : "var(--muted, #8a93a6)",
              cursor: "pointer",
            }}
          >
            {BELT_LABEL_EN[b]}
          </button>
        );
      })}
      {value.length === 0 ? (
        <span style={{ fontSize: 11, color: "var(--muted, #8a93a6)" }}>
          (any belt)
        </span>
      ) : null}
    </div>
  );
}
