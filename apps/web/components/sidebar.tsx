"use client";

import { useState } from "react";
import { subcategoryStatus } from "@karate/core";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { useArea } from "@/lib/area-context";
import { PaceBadge } from "@/components/pace-badge";

interface Props {
  onOpenTournamentSettings: () => void;
}

export function AdminSidebar({ onOpenTournamentSettings }: Props) {
  const { state, setActiveCategory, setActiveSubcategory, setAreaDisabled } = useStore();
  const { hasRole } = useAuth();
  const { current: areaIdx } = useArea();
  const t = state.tournament;
  const isSuperadmin = hasRole("superadmin");
  const areaCount = t.settings.areaCount ?? 1;
  const disabledSet = new Set<number>(t.disabledAreas ?? []);
  // Two-stage disable: first click arms the area for confirm.
  const [armedToDisable, setArmedToDisable] = useState<number | null>(null);
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
      {isSuperadmin ? (
        <div className="area-toggle-block">
          <div className="area-toggle-title">Areas</div>
          <div className="area-toggle-row">
            {Array.from({ length: areaCount }, (_, i) => {
              const isDisabled = disabledSet.has(i);
              const isArmed = armedToDisable === i;
              const enabledCount = areaCount - disabledSet.size;
              const wouldEmpty = !isDisabled && enabledCount <= 1;
              return (
                <button
                  key={i}
                  className={`area-toggle ${isDisabled ? "off" : "on"} ${isArmed ? "armed" : ""}`}
                  disabled={wouldEmpty && !isDisabled}
                  title={
                    isDisabled
                      ? `Area ${i + 1} disabled — click to re-enable`
                      : isArmed
                      ? `Click again to confirm: Area ${i + 1} will receive no more matches`
                      : wouldEmpty
                      ? "Cannot disable the last active area"
                      : `Disable Area ${i + 1}`
                  }
                  onClick={() => {
                    if (isDisabled) {
                      setAreaDisabled(i, false);
                      setArmedToDisable(null);
                      return;
                    }
                    if (isArmed) {
                      setAreaDisabled(i, true);
                      setArmedToDisable(null);
                    } else {
                      setArmedToDisable(i);
                    }
                  }}
                  onBlur={() => { if (isArmed) setArmedToDisable(null); }}
                >
                  {isDisabled ? "⛌" : isArmed ? "⚠" : "●"} A{i + 1}
                  {isArmed ? <span className="armed-tag"> confirm?</span> : null}
                </button>
              );
            })}
          </div>
          {armedToDisable !== null ? (
            <div className="area-toggle-note">
              Click <strong>A{armedToDisable + 1}</strong> again to confirm.
              New matches will be re-routed to other areas until you re-enable it.
            </div>
          ) : null}
        </div>
      ) : null}
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
              {isLocked ? (
                <div className="cat-locked-note">
                  <span className="lock-icon" aria-hidden>⛌</span>
                  <div>
                    <div className="lock-title">Awaiting check-in</div>
                    <div className="lock-sub">Confirm arrivals from the Check-in tab to unlock brackets.</div>
                  </div>
                </div>
              ) : null}
              {!isLocked ? (
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
