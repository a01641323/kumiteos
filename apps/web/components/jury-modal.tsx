"use client";

import { useStore } from "@/lib/store";

export function JuryModal() {
  const { state, resolveJury } = useStore();
  if (!state.jury) return null;
  const [blueName, redName] = state.jury.competitors;
  return (
    <div className="jury-overlay">
      <div className="jury-modal">
        <h2>⚖ Jury Decision Required</h2>
        <div className="jury-subtitle">
          {blueName}  vs  {redName} — select winner
        </div>
        <div className="jury-buttons">
          <button
            className="jury-btn jury-btn-blue"
            onClick={() => resolveJury(blueName)}
          >
            <span className="pre">Blue</span>
            {blueName}
          </button>
          <button
            className="jury-btn jury-btn-red"
            onClick={() => resolveJury(redName)}
          >
            <span className="pre">Red</span>
            {redName}
          </button>
        </div>
      </div>
    </div>
  );
}
