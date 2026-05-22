"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Two-step training match launcher. Step 1 picks discipline (combat /
 * kata); confirming wipes the current scoreboard and loads a blank
 * match with no bracket linkage so the result doesn't touch the
 * tournament data.
 */
export function ExtraMatchModal({ open, onClose }: Props) {
  const { loadExtraMatch, state } = useStore();
  const [discipline, setDiscipline] = useState<"combat" | "kata">("combat");

  if (!open) return null;

  const hasProgress =
    state.match.activeMatchRef !== null ||
    state.match.bluePoints > 0 ||
    state.match.redPoints > 0 ||
    state.match.bluePenalties > 0 ||
    state.match.redPenalties > 0;

  function confirm() {
    loadExtraMatch(discipline);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="auth-card auth-locked" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h1 style={{ fontSize: 22 }}>Match de práctica</h1>
        <p>
          Carga un marcador en blanco para juzgar una pelea de
          entrenamiento. El resultado <strong>no afecta al torneo</strong>:
          no se guarda ningún ganador en el bracket ni se avanza nada.
        </p>

        {hasProgress && (
          <div className="auth-error">
            ⚠ Hay un match cargado en el marcador con progreso. Al continuar
            se <strong>borrará</strong> ese estado (puntos, ammonestaciones,
            timer). Si quieres conservarlo, cancela y reanuda el match
            primero.
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={discipline === "combat" ? "primary" : ""}
            onClick={() => setDiscipline("combat")}
            style={{ flex: 1 }}
          >
            Combat (kumite)
          </button>
          <button
            type="button"
            className={discipline === "kata" ? "primary" : ""}
            onClick={() => setDiscipline("kata")}
            style={{ flex: 1 }}
          >
            Kata
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" className="primary" onClick={confirm} style={{ flex: 1 }}>
            Cargar match de práctica
          </button>
          <button type="button" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
