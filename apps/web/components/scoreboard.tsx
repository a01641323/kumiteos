"use client";

import type { AppState } from "@karate/core";
import { computeWinner } from "@karate/core";

function formatTime(s: number) {
  s = Math.max(0, Math.floor(s));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function shouldBlink(state: AppState): "blue" | "red" | null {
  const m = state.match;
  const isKata = m.discipline === "kata";
  const fiveOut =
    !isKata &&
    (m.bluePenalties >= 5 ||
      m.redPenalties >= 5 ||
      m.blueEliminated ||
      m.redEliminated);
  const elimKata = isKata && (m.blueEliminated || m.redEliminated);
  const finished = state.timer.finished && !isKata;
  const threshold = state.tournament?.settings?.pointDifference ?? 0;
  const pointWin =
    !isKata &&
    threshold > 0 &&
    Math.abs(m.bluePoints - m.redPoints) >= threshold;
  if (!fiveOut && !finished && !elimKata && !pointWin) return null;
  return computeWinner(m, threshold > 0 ? threshold : undefined);
}

interface Props {
  state: AppState;
  /** When 'public', sides are mirrored (red on left). */
  variant: "private" | "public";
}

export function Scoreboard({ state, variant }: Props) {
  const m = state.match;
  const t = state.timer;
  const blink = shouldBlink(state);
  const matchType = m.discipline ? m.discipline.toUpperCase() : "";

  const blue = (
    <div className="side blue">
      <span className="role-tag">Blue · Ao</span>
      <div className={`name ${m.blueEliminated ? "eliminated" : ""}`}>
        {m.blueName || "—"}
      </div>
      <div className="score-row">
        <div className={`score ${blink === "blue" ? "blink" : ""}`}>
          {m.bluePoints}
        </div>
        <div className={`star ${m.blueAdvantage ? "on" : ""}`}>★</div>
      </div>
      <Penalties count={m.bluePenalties} />
    </div>
  );

  const red = (
    <div className="side red">
      <span className="role-tag">Red · Aka</span>
      <div className={`name ${m.redEliminated ? "eliminated" : ""}`}>
        {m.redName || "—"}
      </div>
      <div className="score-row">
        {variant === "public" ? (
          <>
            <div className={`score ${blink === "red" ? "blink" : ""}`}>
              {m.redPoints}
            </div>
            <div className={`star ${m.redAdvantage ? "on" : ""}`}>★</div>
          </>
        ) : (
          <>
            <div className={`star ${m.redAdvantage ? "on" : ""}`}>★</div>
            <div className={`score ${blink === "red" ? "blink" : ""}`}>
              {m.redPoints}
            </div>
          </>
        )}
      </div>
      <Penalties count={m.redPenalties} />
    </div>
  );

  const center = (
    <div className="center">
      <div className="timer-label">Time Remaining</div>
      <div
        className={
          "timer " +
          (t.remaining === 0
            ? "zero"
            : t.remaining <= 15
            ? "warn"
            : "") +
          (!t.running && t.remaining > 0 && !t.finished ? " paused" : "")
        }
      >
        {formatTime(t.remaining)}
      </div>
      <div className="timer-status">
        {variant === "private"
          ? t.finished
            ? "Time"
            : t.running
            ? "Running"
            : "Paused"
          : t.finished
          ? "Time"
          : ""}
      </div>
      {variant === "private" ? <ShortcutsPanel discipline={m.discipline} /> : null}
    </div>
  );

  const logoUrl = state.tournament.meta?.logoUrl ?? null;
  return (
    <>
      <div className={`match-type-label ${m.discipline || ""}`}>
        {matchType}
      </div>
      {logoUrl ? (
        <div
          className="scoreboard-logo"
          style={{
            position: "absolute",
            top: variant === "public" ? 18 : 8,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt=""
            style={{
              maxHeight: variant === "public" ? 80 : 48,
              maxWidth: 220,
              objectFit: "contain",
              filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.4))",
            }}
          />
        </div>
      ) : null}
      <div className="split">
        {variant === "public" ? (
          <>
            {red}
            {center}
            {blue}
          </>
        ) : (
          <>
            {blue}
            {center}
            {red}
          </>
        )}
      </div>
      <TieBreakFlash state={state} />
    </>
  );
}

function TieBreakFlash({ state }: { state: AppState }) {
  const flash = state.flash;
  if (!flash || flash.kind !== "tiebreak") return null;
  if (flash.expiresAtMs <= Date.now()) return null;
  const label =
    flash.reason === "ippon"  ? "MÁS IPPON"  :
    flash.reason === "wasari" ? "MÁS WASARI" :
    "MÁS YUKO";
  return (
    <div className="tiebreak-flash">
      <div className="tiebreak-flash-label">{label}</div>
      <div className="tiebreak-flash-name">{flash.winnerName}</div>
    </div>
  );
}

function ShortcutsPanel({ discipline }: { discipline: import("@karate/core").Discipline | null }) {
  if (discipline === "kata") {
    return (
      <div className="shortcuts" aria-label="Keyboard shortcuts (kata)">
        <Row
          label="select side, then award score (opponent gets 5 − score)"
          keys={["A", "R"]}
          sep="/"
          suffix={
            <>
              <span className="sep">→</span>
              <span className="kbd">1</span>
              <span className="sep">·</span>
              <span className="kbd">2</span>
              <span className="sep">·</span>
              <span className="kbd">3</span>
              <span className="sep">·</span>
              <span className="kbd">4</span>
            </>
          }
        />
        <Row label="undo last action within 10s (no side selected)" keys={["Del", "⌫"]} sep="/" />
      </div>
    );
  }
  return (
    <div className="shortcuts" aria-label="Keyboard shortcuts">
      <Row label="pause / resume timer" keys={["Space"]} />
      <Row label="adjust timer ±1s" keys={["+", "−"]} sep="/" />
      <Row
        label="select side, then add points"
        keys={["A", "R"]}
        sep="/"
        suffix={
          <>
            <span className="sep">→</span>
            <span className="kbd">1</span>
            <span className="sep">·</span>
            <span className="kbd">2</span>
            <span className="sep">·</span>
            <span className="kbd">3</span>
            <span className="sep" style={{ opacity: 0.5 }}>(or</span>
            <span className="kbd">Y</span>
            <span className="kbd">W</span>
            <span className="kbd">I</span>
            <span className="sep" style={{ opacity: 0.5 }}>)</span>
          </>
        }
      />
      <Row label="toggle advantage (after side)" keys={["S"]} />
      <Row label="add penalty (after side)" keys={["C"]} accent />
      <Row label="undo last action within 10s (no side selected)" keys={["Del", "⌫"]} sep="/" />
      <Row label="advance match (after winner / timeout)" keys={["Enter"]} />
    </div>
  );
}

function Row({
  keys, label, sep, suffix, accent,
}: {
  keys: string[];
  label: string;
  sep?: string;
  suffix?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="shortcut-row">
      {keys.map((k, i) => (
        <span key={i} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {i > 0 && sep && <span className="sep">{sep}</span>}
          <span className={`kbd${accent ? " accent" : ""}`}>{k}</span>
        </span>
      ))}
      {suffix}
      <span className="label" style={{ marginLeft: 6 }}>{label}</span>
    </div>
  );
}

function Penalties({ count }: { count: number }) {
  return (
    <div className="penalties">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={"penalty" + (i < count ? " on" : "")} />
      ))}
    </div>
  );
}
