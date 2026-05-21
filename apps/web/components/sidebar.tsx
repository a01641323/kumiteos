"use client";

import { subcategoryStatus } from "@karate/core";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { useArea } from "@/lib/area-context";
import { PaceBadge } from "@/components/pace-badge";

interface Props {
  onOpenTournamentSettings: () => void;
}

export function AdminSidebar({ onOpenTournamentSettings }: Props) {
  const { state, setActiveCategory, setActiveSubcategory } = useStore();
  const { hasRole } = useAuth();
  const { current: areaIdx } = useArea();
  const t = state.tournament;
  const isSuperadmin = hasRole("superadmin");
  // Superadmin always sees the union view — the per-subcategory area
  // badge below already shows where each fight is running, so an
  // extra filter is just noise. Referees still see only their area.
  const filterByArea = !isSuperadmin && typeof areaIdx === "number";

  return (
    <aside className="admin-sidebar">
      {isSuperadmin ? (
        <button className="tourn-settings-btn" onClick={onOpenTournamentSettings}>
          ⚙ Tournament Settings
        </button>
      ) : (
        <div className="area-chip">
          <span className="muted-mono">REFEREEING</span>
          <span className="area-chip-label">Area {(areaIdx ?? 0) + 1}</span>
        </div>
      )}
      <h3>Categories</h3>
      <div>
        {t.categoryOrder.map((cid) => {
          const cat = t.categories[cid];
          if (!cat) return null;

          // Filter subcategories by area for referees.
          const visibleSubs = filterByArea
            ? cat.subcategories.filter(
                (s) => t.areaAssignments[s.id] === areaIdx
              )
            : cat.subcategories;
          if (filterByArea && visibleSubs.length === 0) return null;

          const isActiveCat = cid === t.activeCategoryId;
          const isLocked = cat.started === false;
          return (
            <div key={cid} className={`cat-group ${isLocked ? "locked" : ""}`}>
              <button
                className={`cat-btn ${isActiveCat ? "active" : ""}`}
                onClick={() => setActiveCategory(cid)}
              >
                <span>{cat.name}</span>
                <span className="count">
                  {isLocked
                    ? `${cat.competitors.length} · locked`
                    : `${cat.competitors.length} · ${visibleSubs.length}`}
                </span>
              </button>
              {isActiveCat && isLocked ? (
                <div className="cat-locked-note">
                  <span className="lock-icon" aria-hidden>⛌</span>
                  <div>
                    <div className="lock-title">Awaiting check-in</div>
                    <div className="lock-sub">Confirm arrivals from the Check-in tab to unlock brackets.</div>
                  </div>
                </div>
              ) : null}
              {isActiveCat && !isLocked ? (
                <div className="subcat-list">
                  {visibleSubs.map((sub) => {
                    const status = subcategoryStatus(sub);
                    const isActiveSub = sub.id === cat.activeSubcategoryId;
                    const subArea = t.areaAssignments[sub.id];
                    return (
                      <button
                        key={sub.id}
                        className={`subcat-btn ${isActiveSub ? "active" : ""}`}
                        onClick={() => setActiveSubcategory(cid, sub.id)}
                      >
                        <span className={`status-dot ${status}`} />
                        <span>{sub.label}</span>
                        {sub.tag ? (
                          <span className={`subcat-tag ${sub.tag}`}>
                            {sub.tag}
                          </span>
                        ) : null}
                        {typeof subArea === "number" && (
                          <span
                            className={`area-tag area-tag-${(subArea % 6) + 1}`}
                            title={`Assigned to Area ${subArea + 1}`}
                          >
                            A{subArea + 1}
                          </span>
                        )}
                        <PaceBadge state={state} subcategoryId={sub.id} />
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
