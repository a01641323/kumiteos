"use client";

import { useEffect, useRef, useState } from "react";
import type { CommandKey } from "@karate/core";
import { KEY_LABELS } from "@karate/core";
import { useStore } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

function displayKey(k: string): string {
  if (k === " ") return "Space";
  if (k === "Delete") return "Delete";
  if (k === "Backspace") return "Backspace";
  if (k === "ArrowUp") return "↑";
  if (k === "ArrowDown") return "↓";
  if (k === "ArrowLeft") return "←";
  if (k === "ArrowRight") return "→";
  if (typeof k === "string" && k.length === 1) return k.toUpperCase();
  return k;
}

export function SettingsModal({ open, onClose }: Props) {
  const { state, saveAppSettings } = useStore();
  const [duration, setDuration] = useState(state.settings.defaultDuration);
  const [keys, setKeys] = useState({ ...state.settings.keys });
  const [capturing, setCapturing] = useState<CommandKey | null>(null);
  const captureRef = useRef<CommandKey | null>(null);
  captureRef.current = capturing;

  useEffect(() => {
    if (!open) return;
    setDuration(state.settings.defaultDuration);
    setKeys({ ...state.settings.keys });
    setCapturing(null);
  }, [open, state.settings]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const c = captureRef.current;
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      setKeys((prev) => ({ ...prev, [c]: e.key }));
      setCapturing(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open]);

  if (!open) return null;

  const save = () => {
    saveAppSettings(Number(duration), keys);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Settings</h2>

        <h3>Timer</h3>
        <div className="kb-row">
          <span className="kb-name">
            Default match duration (seconds)
          </span>
          <input
            type="number"
            className="duration-input"
            min={10}
            max={3600}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>

        <h3>Keyboard Shortcuts</h3>
        <div>
          {(Object.keys(KEY_LABELS) as CommandKey[]).map((k) => (
            <div key={k} className="kb-row">
              <span className="kb-name">{KEY_LABELS[k]}</span>
              <button
                className={`kb-key ${capturing === k ? "listening" : ""}`}
                onClick={() => setCapturing(k)}
              >
                {capturing === k ? "Press a key…" : displayKey(keys[k])}
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
