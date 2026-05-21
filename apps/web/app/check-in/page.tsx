"use client";

import { useMemo, useState } from "react";
import type { Participant } from "@karate/core";
import { findCategoryForParticipant } from "@karate/core";
import { useStore } from "@/lib/store";
import { StartCategoryModal } from "@/components/start-category-modal";

interface CatBucket {
  catId: string;
  catName: string;
  participants: Participant[];
}

export default function CheckInPage() {
  const { state, markArrived } = useStore();
  const [openCatId, setOpenCatId] = useState<string | null>(null);

  const buckets: CatBucket[] = useMemo(() => {
    const out: CatBucket[] = [];
    for (const def of state.tournament.categoryDefs) {
      const cat = state.tournament.categories[def.id];
      // Skip categories that have already been started — once locked in,
      // their roster cannot change from this view.
      if (cat?.started) continue;
      const ps = state.tournament.participants.filter(
        (p) => findCategoryForParticipant(state.tournament.categoryDefs, p)?.id === def.id,
      );
      if (ps.length === 0) continue;
      out.push({
        catId: def.id,
        catName: cat?.name ?? def.name,
        participants: ps.slice().sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`)),
      });
    }
    return out;
  }, [state.tournament]);

  const startedCount = state.tournament.categoryOrder.filter(
    (id) => state.tournament.categories[id]?.started,
  ).length;
  const pendingCount = buckets.length;

  const activeBucket = buckets.find((b) => b.catId === openCatId) ?? null;
  const absentNames = activeBucket
    ? activeBucket.participants.filter((p) => p.arrived === false).map((p) => `${p.nombre} ${p.apellido}`.trim())
    : [];

  return (
    <div className="check-in-page">
      <header className="check-in-header">
        <div>
          <h1>Check-in</h1>
          <p className="muted">
            Confirm who arrived. Only checked-in participants will be seeded
            into the brackets when you start the category.
          </p>
        </div>
        <div className="check-in-meta">
          <span className="check-in-pill">
            {startedCount} started · {pendingCount} pending
          </span>
        </div>
      </header>

      {buckets.length === 0 ? (
        <div className="check-in-empty">
          <p>
            {state.tournament.participants.length === 0
              ? "No participants uploaded yet. Use the superadmin overlay to load a CSV or generate a mock tournament."
              : "Every category is already started. Nothing left to check in."}
          </p>
        </div>
      ) : (
        <div className="check-in-list">
          {buckets.map((b) => (
            <CategoryCard
              key={b.catId}
              bucket={b}
              onToggle={(id, arrived) => markArrived(id, arrived)}
              onStart={() => setOpenCatId(b.catId)}
            />
          ))}
        </div>
      )}

      {activeBucket && (
        <StartCategoryModal
          catId={activeBucket.catId}
          catName={activeBucket.catName}
          absentNames={absentNames}
          onClose={() => setOpenCatId(null)}
        />
      )}
    </div>
  );
}

function CategoryCard({
  bucket, onToggle, onStart,
}: {
  bucket: CatBucket;
  onToggle: (id: string, arrived: boolean) => void;
  onStart: () => void;
}) {
  const [query, setQuery] = useState("");
  const visible = bucket.participants.filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return `${p.nombre} ${p.apellido}`.toLowerCase().includes(q);
  });
  const arrived = bucket.participants.filter((p) => p.arrived !== false).length;
  const total = bucket.participants.length;
  const missing = total - arrived;

  function markAllArrived() {
    for (const p of bucket.participants) {
      if (p.arrived !== true) onToggle(p.id, true);
    }
  }

  return (
    <section className="check-in-card">
      <header className="check-in-card-head">
        <div>
          <div className="check-in-card-title">{bucket.catName}</div>
          <div className="check-in-card-count">
            <span className="green-tag">{arrived}</span>
            <span className="sep">/</span>
            <span>{total}</span>
            <span className="muted-mono">arrived</span>
            {missing > 0 && (
              <>
                <span className="sep">·</span>
                <span className="amber-tag">{missing}</span>
                <span className="muted-mono">pending</span>
              </>
            )}
          </div>
        </div>
        <div className="check-in-card-actions">
          <button type="button" className="ghost-btn" onClick={markAllArrived}>
            Mark all as arrived
          </button>
          <button type="button" className="primary" onClick={onStart}>
            Start category →
          </button>
        </div>
      </header>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        className="check-in-search"
      />

      <ul className="check-in-roster">
        {visible.map((p) => {
          const a = p.arrived !== false;
          return (
            <li key={p.id} className={`check-in-row ${a ? "arrived" : ""}`}>
              <label>
                <input
                  type="checkbox"
                  checked={a}
                  onChange={(e) => onToggle(p.id, e.target.checked)}
                />
                <span className="check-in-name">
                  {p.nombre} {p.apellido}
                </span>
                <span className="check-in-meta-cell">
                  <span className="muted-mono">{p.beltColor.toUpperCase()}</span>
                  <span className="sep">·</span>
                  <span className="muted-mono">{p.age}y</span>
                </span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="check-in-empty-row">No matches for "{query}"</li>
        )}
      </ul>
    </section>
  );
}
