"use client";

import { useStore } from "@/lib/store";

interface Props {
  catId: string;
  catName: string;
  absentNames: string[];
  onClose: () => void;
}

/**
 * Two-stage confirmation for locking a category in. The first stage is
 * the operator clicking "Start category" on the check-in page (which
 * opens this modal). This component is the second stage: the names of
 * the absent participants are listed explicitly so the operator can
 * read who's about to be removed, then confirm.
 *
 * Idempotent — clicking confirm twice is harmless.
 */
export function StartCategoryModal({ catId, catName, absentNames, onClose }: Props) {
  const { startCategory } = useStore();

  function confirm() {
    startCategory(catId);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="auth-card auth-locked"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h1 style={{ fontSize: 22 }}>Start {catName}?</h1>
        {absentNames.length === 0 ? (
          <p>Everyone in this category has checked in. Brackets will be
          generated and the category will be unlocked for scoring.</p>
        ) : (
          <>
            <p>
              <strong>{absentNames.length}</strong>{" "}
              {absentNames.length === 1 ? "participant" : "participants"} did not
              check in. Starting this category will <strong>remove them from the
              tournament</strong>; they will not be re-seeded into any bracket.
            </p>
            <ul className="absent-list">
              {absentNames.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="muted small">
              This cannot be undone — restart the app to recover a removed
              participant from the on-disk snapshot.
            </p>
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" className="primary" onClick={confirm} style={{ flex: 1 }}>
            {absentNames.length === 0
              ? "Confirm · start category"
              : `Remove ${absentNames.length} & start`}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
