"use client";

import { useStore } from "@/lib/store";

export function SeedingSection() {
  const { state, reseed } = useStore();
  const seed = state.tournament.meta.seed;

  return (
    <section className="super-section">
      <h2>Seeding</h2>
      <p className="muted">
        Each category's competitors are shuffled with a deterministic random
        seed before being partitioned into subcategories. Re-running with the
        same seed reproduces identical brackets, so results stay verifiable.
      </p>
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13 }}>Current seed:</span>
        <code
          style={{
            fontSize: 13,
            background: "var(--panel-2, #1d2230)",
            padding: "4px 10px",
            borderRadius: 6,
          }}
        >
          {seed}
        </code>
        <span className="right" />
        <button onClick={() => reseed()}>Generate new seed</button>
        <button
          onClick={() => {
            const v = window.prompt("Set explicit seed value (integer):", String(seed));
            if (v === null) return;
            const n = Number(v);
            if (!Number.isFinite(n)) {
              window.alert("Seed must be a number.");
              return;
            }
            reseed(Math.floor(n));
          }}
        >
          Set explicit seed…
        </button>
      </div>
    </section>
  );
}
