"use client";

import { useState } from "react";
import { allMatchesComplete, describeRefLabel, getMatchByRef } from "@karate/core";
import { useStore } from "@/lib/store";
import { Scoreboard } from "@/components/scoreboard";
import { KeyboardHandler } from "@/components/keyboard-handler";
import { SettingsModal } from "@/components/settings-modal";
import { NextMatchPanel } from "@/components/next-match-panel";
import { ExtraMatchModal } from "@/components/extra-match-modal";

export default function PrivatePage() {
  const {
    state,
    advanceActiveMatch,
    eliminate,
    resetScoreboard,
  } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);

  const ref = state.match.activeMatchRef;
  const m = ref ? getMatchByRef(state, ref) : null;
  const done = !ref && allMatchesComplete(state);
  // Match-over predicate — same as the Enter keyboard gate. The button
  // stays disabled until the match resolves naturally.
  const matchOver =
    !!ref &&
    (state.timer.finished ||
      state.timer.remaining === 0 ||
      state.match.bluePenalties >= 5 ||
      state.match.redPenalties >= 5 ||
      state.match.blueEliminated ||
      state.match.redEliminated ||
      (!!m && !!m.winner));
  const advLabel = done
    ? "🏆 Torneo completo — no hay más encuentros"
    : ref
    ? m && m.winner
      ? `Advanced · ${describeRefLabel(state, ref)}`
      : matchOver
      ? `Advance · ${describeRefLabel(state, ref)}`
      : `Match in progress · waiting for result`
    : "Advance · no match loaded";
  const advDisabled = done || !ref || !m || !!m.winner || !matchOver;

  return (
    <section id="view-private">
      <KeyboardHandler suppress={settingsOpen || !!state.jury} />
      <NextMatchPanel />
      <Scoreboard state={state} variant="private" />
      <div className="private-controls">
        <div className="control-group">
          <button onClick={() => setSettingsOpen(true)}>
            ⚙ Change Settings
          </button>
          <button onClick={() => setExtraOpen(true)} title="Score a practice match without affecting the tournament">
            ✦ Match de práctica
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
          <button className="reset-btn" onClick={() => resetScoreboard()}>
            Reset Scoreboard
          </button>
        </div>
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <ExtraMatchModal
        open={extraOpen}
        onClose={() => setExtraOpen(false)}
      />
    </section>
  );
}
