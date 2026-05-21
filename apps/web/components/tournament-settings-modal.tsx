"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BeltColor,
  DisciplineMode,
  Participant,
  SubcategorySize,
} from "@karate/core";
import {
  BELT_LABEL_EN,
  BELT_ORDER,
  parseParticipantsCsv,
  stringifyParticipantsCsv,
} from "@karate/core";
import { useStore } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TournamentSettingsModal({ open, onClose }: Props) {
  const {
    state,
    applyTournamentSettings,
    replaceParticipants,
    addParticipant,
    removeParticipant,
  } = useStore();
  const [size, setSize] = useState<SubcategorySize>(
    state.tournament.settings.subcategorySize
  );
  const [mode, setMode] = useState<DisciplineMode>(
    state.tournament.settings.disciplineMode
  );
  const [pointDiff, setPointDiff] = useState<number>(
    state.tournament.settings.pointDifference ?? 8
  );
  const [feedback, setFeedback] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add-participant form
  const [pNombre, setPNombre] = useState("");
  const [pApellido, setPApellido] = useState("");
  const [pBelt, setPBelt] = useState<BeltColor>("white");
  const [pAge, setPAge] = useState<number | "">("");

  useEffect(() => {
    if (!open) return;
    setSize(state.tournament.settings.subcategorySize);
    setMode(state.tournament.settings.disciplineMode);
    setPointDiff(state.tournament.settings.pointDifference ?? 8);
    setFeedback("");
    setPNombre("");
    setPApellido("");
    setPBelt("white");
    setPAge("");
  }, [open, state.tournament.settings]);

  if (!open) return null;

  const apply = () => {
    const ok = applyTournamentSettings(size, mode, pointDiff);
    if (
      ok ||
      (size === state.tournament.settings.subcategorySize &&
        mode === state.tournament.settings.disciplineMode &&
        pointDiff === (state.tournament.settings.pointDifference ?? 8))
    ) {
      onClose();
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseParticipantsCsv(text);
    if (result.errors.length > 0) {
      setFeedback(
        `❌ ${result.errors.length} error(s): ` +
          result.errors
            .slice(0, 3)
            .map((er) => `line ${er.line}: ${er.message}`)
            .join("; ")
      );
      e.target.value = "";
      return;
    }
    const existing = state.tournament.participants.length;
    const proceed =
      existing === 0 ||
      window.confirm(
        `Replace ${existing} existing participant(s) with ${result.participants.length} from CSV? All bracket progress will be reset.`
      );
    if (!proceed) {
      e.target.value = "";
      return;
    }
    replaceParticipants(result.participants);
    setFeedback(`✓ Loaded ${result.participants.length} participants`);
    e.target.value = "";
  };

  const onDownloadCurrent = () => {
    const csv = stringifyParticipantsCsv(state.tournament.participants);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "participants.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onAddParticipant = () => {
    const nombre = pNombre.trim();
    const apellido = pApellido.trim();
    const age = typeof pAge === "number" ? pAge : Number.parseInt(String(pAge), 10);
    if (!nombre || !apellido) {
      setFeedback("Nombre and apellido are required.");
      return;
    }
    if (!Number.isFinite(age) || age < 3 || age > 99) {
      setFeedback("Age must be a number between 3 and 99.");
      return;
    }
    addParticipant({ nombre, apellido, beltColor: pBelt, age });
    setFeedback(`✓ Added ${nombre} ${apellido}`);
    setPNombre("");
    setPApellido("");
    setPAge("");
  };

  const participants = state.tournament.participants;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 720 }}>
        <h2>Tournament Settings</h2>

        <h3>Subcategory Size</h3>
        <div className="radio-group">
          {[4, 8, 16].map((v) => (
            <label
              key={v}
              className={size === v ? "checked" : ""}
              onClick={() => setSize(v as SubcategorySize)}
            >
              <input type="radio" name="subsize" checked={size === v} readOnly />
              {v}
            </label>
          ))}
        </div>

        <h3>Discipline Mode</h3>
        <div className="radio-group">
          {(["combat", "kata", "both"] as DisciplineMode[]).map((m) => (
            <label
              key={m}
              className={mode === m ? "checked" : ""}
              onClick={() => setMode(m)}
            >
              <input type="radio" name="discmode" checked={mode === m} readOnly />
              {m === "combat" ? "Combat" : m === "kata" ? "Kata" : "Both"}
            </label>
          ))}
        </div>

        <h3>Point Difference Win</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="number"
            min={0}
            max={20}
            value={pointDiff}
            onChange={(e) => setPointDiff(Math.max(0, Number(e.target.value) || 0))}
            className="duration-input"
            style={{ width: 72 }}
          />
          <span style={{ color: "#888", fontSize: 12 }}>
            points lead to win automatically (0 = disabled, default 8)
          </span>
        </div>

        <h3>
          Participants <span style={{ color: "#888", fontSize: 11 }}>
            ({participants.length})
          </span>
        </h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            style={{ padding: "10px 16px", borderRadius: 5 }}
            onClick={() => fileInputRef.current?.click()}
          >
            📥 Load from CSV…
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "10px 16px", borderRadius: 5 }}
            disabled={participants.length === 0}
            onClick={onDownloadCurrent}
          >
            ⬇ Download current
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={onFile}
          />
        </div>

        <div
          style={{
            marginTop: 14,
            padding: 14,
            background: "#0d0d0d",
            border: "1px solid #1f1f1f",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: 2,
              color: "#888",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Add participant
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <input
              type="text"
              placeholder="Nombre"
              value={pNombre}
              onChange={(e) => setPNombre(e.target.value)}
              className="duration-input"
              style={{ width: "100%" }}
            />
            <input
              type="text"
              placeholder="Apellido"
              value={pApellido}
              onChange={(e) => setPApellido(e.target.value)}
              className="duration-input"
              style={{ width: "100%" }}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr auto",
              gap: 8,
            }}
          >
            <select
              value={pBelt}
              onChange={(e) => setPBelt(e.target.value as BeltColor)}
              className="duration-input"
              style={{ width: "100%" }}
            >
              {BELT_ORDER.map((b) => (
                <option key={b} value={b}>
                  {BELT_LABEL_EN[b]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={3}
              max={99}
              placeholder="Edad"
              value={pAge}
              onChange={(e) =>
                setPAge(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="duration-input"
              style={{ width: "100%" }}
            />
            <button
              className="btn-primary"
              style={{ padding: "8px 16px", borderRadius: 5 }}
              onClick={onAddParticipant}
            >
              + Add
            </button>
          </div>
        </div>

        {participants.length > 0 ? (
          <div
            style={{
              marginTop: 12,
              maxHeight: 180,
              overflowY: "auto",
              border: "1px solid #1f1f1f",
              borderRadius: 6,
            }}
          >
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#161616" }}>
                  <th style={th}>Nombre</th>
                  <th style={th}>Apellido</th>
                  <th style={th}>Belt</th>
                  <th style={th}>Age</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {participants.slice(0, 200).map((p) => (
                  <ParticipantRow
                    key={p.id}
                    p={p}
                    onRemove={() => removeParticipant(p.id)}
                  />
                ))}
                {participants.length > 200 ? (
                  <tr>
                    <td colSpan={5} style={{ ...td, color: "#888", textAlign: "center" }}>
                      … {participants.length - 200} more (truncated)
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {feedback ? (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              fontSize: 12.5,
              color: feedback.startsWith("❌") ? "#ff8080" : "#8fe39d",
              background: feedback.startsWith("❌")
                ? "rgba(255,48,48,0.08)"
                : "rgba(46,204,113,0.08)",
              border: "1px solid " + (feedback.startsWith("❌") ? "#5a0000" : "#1d4a30"),
              borderRadius: 5,
            }}
          >
            {feedback}
          </div>
        ) : null}

        <p className="warn">
          ⚠ Changing subcategory size or discipline mode resets bracket progress.
          Loading a CSV or adding a participant rebuilds the affected categories.
        </p>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" onClick={apply}>
            Apply settings
          </button>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "6px 10px",
  textAlign: "left",
  fontSize: 10,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "#888",
  borderBottom: "1px solid #1f1f1f",
  fontWeight: 700,
};
const td: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #1a1a1a" };

function ParticipantRow({
  p,
  onRemove,
}: {
  p: Participant;
  onRemove: () => void;
}) {
  return (
    <tr>
      <td style={td}>{p.nombre}</td>
      <td style={td}>{p.apellido}</td>
      <td style={td}>{BELT_LABEL_EN[p.beltColor]}</td>
      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{p.age}</td>
      <td style={{ ...td, textAlign: "right" }}>
        <button
          onClick={onRemove}
          style={{
            background: "transparent",
            border: "none",
            color: "#ff8080",
            cursor: "pointer",
            fontSize: 14,
            padding: "0 4px",
          }}
          title="Remove"
        >
          ×
        </button>
      </td>
    </tr>
  );
}
