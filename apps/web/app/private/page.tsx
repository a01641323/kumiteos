"use client";

import { useState } from "react";
import { allMatchesComplete, describeRefLabel, getMatchByRef } from "@karate/core";
import { useStore } from "@/lib/store";
import { Scoreboard } from "@/components/scoreboard";
import { KeyboardHandler } from "@/components/keyboard-handler";
import { SettingsModal } from "@/components/settings-modal";
import { NextMatchPanel } from "@/components/next-match-panel";
import { isElectron } from "@/lib/api-client";

function openPublicDisplay() {
  if (typeof window === "undefined") return;
  const bridge = (window as unknown as {
    __KARATE__?: { openPublicWindow?: () => void };
  }).__KARATE__;
  if (bridge?.openPublicWindow) {
    bridge.openPublicWindow();
    return;
  }
  const w = window.open("/public", "_blank", "noopener");
  if (w) w.focus();
}

export default function PrivatePage() {
  const {
    state,
    advanceActiveMatch,
    eliminate,
    resetScoreboard,
  } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const ref = state.match.activeMatchRef;
  const m = ref ? getMatchByRef(state, ref) : null;
  const done = !ref && allMatchesComplete(state);
  const advLabel = done
    ? "🏆 Torneo completo — no hay más encuentros"
    : ref
    ? m && m.winner
      ? `Advanced · ${describeRefLabel(state, ref)}`
      : `Advance · ${describeRefLabel(state, ref)}`
    : "Advance · no match loaded";
  const advDisabled = done || !ref || !m || !!m.winner;

  return (
    <section id="view-private" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 44px)" }}>
      <KeyboardHandler suppress={settingsOpen || !!state.jury} />
      <NextMatchPanel />
      <Scoreboard state={state} variant="private" />
      <div className="private-controls">
        <div className="control-group">
          <button onClick={() => setSettingsOpen(true)}>
            ⚙ Change Settings
          </button>
          <button onClick={openPublicDisplay} title="Open the audience scoreboard in a separate window">
            🖥 Open Public Display
          </button>
        </div>
        <div className="control-group">
          <button
            className="advance-btn"
            disabled={advDisabled}
            onClick={advanceActiveMatch}
          >
            {advLabel}
          </button>
        </div>
        <div className="control-group">
          <button className="blue-btn" onClick={() => eliminate("blue")}>
            ✕ Eliminate Blue
          </button>
          <button className="red-btn" onClick={() => eliminate("red")}>
            ✕ Eliminate Red
          </button>
          <button className="danger" onClick={() => resetScoreboard()}>
            Reset Scoreboard
          </button>
        </div>
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </section>
  );
}
