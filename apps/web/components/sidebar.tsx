"use client";

import { subcategoryStatus } from "@karate/core";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { useArea } from "@/lib/area-context";

interface Props {
  onOpenTournamentSettings: () => void;
}

export function AdminSidebar({ onOpenTournamentSettings }: Props) {
  const { state, setActiveCategory, setActiveSubcategory } = useStore();
  const { hasRole } = useAuth();
  const { current: areaIdx } = useArea();
  const t = state.tournament;
  const isSuperadmin = hasRole("superadmin");
  const filterByArea = !isSuperadmin && typeof areaIdx === "number";

  return (
    <aside className="admin-sidebar">
      {isSuperadmin ? (
        <button className="tourn-settings-btn" onClick={onOpenTournamentSettings}>
          ⚙ Tournament Settings
        </button>
      ) : (
        <div
          className="muted"
          style={{ fontSize: 12, padding: "8px 12px", borderBottom: "1px solid var(--border, #2a3142)" }}
        >
          Refereeing Area {(areaIdx ?? 0) + 1}
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
          return (
            <div key={cid} className="cat-group">
              <button
                className={`cat-btn ${isActiveCat ? "active" : ""}`}
                onClick={() => setActiveCategory(cid)}
              >
                <span>{cat.name}</span>
                <span className="count">
                  {cat.competitors.length} · {visibleSubs.length}
                </span>
              </button>
              {isActiveCat ? (
                <div className="subcat-list">
                  {visibleSubs.map((sub) => {
                    const status = subcategoryStatus(sub);
                    const isActiveSub = sub.id === cat.activeSubcategoryId;
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
