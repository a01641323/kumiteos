"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { areaLabel, buildAreaPlan } from "@karate/core";
import { useStore } from "@/lib/store";
import { useArea } from "@/lib/area-context";

export default function AreaSelectPage() {
  const router = useRouter();
  const { state } = useStore();
  const { setArea } = useArea();

  const plan = useMemo(
    () =>
      buildAreaPlan(
        {
          categoryOrder: state.tournament.categoryOrder,
          categories: state.tournament.categories,
          areaCount: state.tournament.settings.areaCount,
        },
        state.tournament.areaAssignments
      ),
    [state.tournament]
  );

  const totalSubs = plan.areas.reduce((acc, a) => acc + a.subcategoryIds.length, 0);

  function pick(idx: number) {
    setArea(idx);
    router.push("/admin");
  }

  return (
    <main className="area-select">
      <h1>Choose your competition area</h1>
      <p className="lead">
        Select the area you'll referee. You can change it any time from the top
        bar.
      </p>
      {totalSubs === 0 ? (
        <div className="auth-card auth-locked" style={{ margin: 0 }}>
          <h1>No subcategories yet</h1>
          <p>
            Tournament data hasn't been generated. Ask the administrator to add
            participants and configure categories.
          </p>
        </div>
      ) : (
        <div className="area-grid">
          {plan.areas.map((a) => (
            <button
              key={a.index}
              className="area-card"
              type="button"
              onClick={() => pick(a.index)}
            >
              <div className="area-num">{a.index + 1}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{areaLabel(a.index)}</div>
              <div className="area-meta">
                {a.subcategoryIds.length} subcategor{a.subcategoryIds.length === 1 ? "y" : "ies"}
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
