"use client";

import { useStore } from "@/lib/store";

export function JuryModal() {
  const { state, resolveJury } = useStore();
  if (!state.jury) return null;
  const [blueName, redName] = state.jury.competitors;
  return (
    <div className="jury-overlay">
      <div className="jury-modal">
        <h2>Decisión del jurado</h2>
        <div className="jury-subtitle">Selecciona al ganador</div>
        <div className="jury-buttons">
          <button
            className="jury-btn jury-btn-blue"
            onClick={() => resolveJury(blueName)}
          >
            <span className="pre">Azul</span>
            {blueName}
          </button>
          <button
            className="jury-btn jury-btn-red"
            onClick={() => resolveJury(redName)}
          >
            <span className="pre">Rojo</span>
            {redName}
          </button>
        </div>
      </div>
    </div>
  );
}
