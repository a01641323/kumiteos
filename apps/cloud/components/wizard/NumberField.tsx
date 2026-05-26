"use client";

// Text-mode numeric input that behaves like a normal field — no
// leading-zero stickiness, no enforced increments, backspace works
// freely. The default shows as a placeholder (gray ghost text) so the
// user can click and type without erasing anything first.
//
// State model: caller owns the canonical number (and the default).
// We keep an internal string buffer so partial / empty typing isn't
// fought by the parent re-render. If the buffer is empty, the
// `defaultValue` is reported to the parent; if it has digits, we
// parse + clamp on commit (blur or paste). Clamping at typing time
// would prevent the user from typing "12" when max is 20 (the "1"
// would be valid, but then "12" rebuilds via React render).

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  onChange: (v: number) => void;
  /** Shown as ghost text when the buffer is empty. */
  defaultValue: number;
  min?: number;
  max?: number;
  /** Allow null when the buffer is empty (used for "sin tope" maxAge). */
  allowNull?: boolean;
  onNull?: () => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

function clampRange(n: number, min: number | undefined, max: number | undefined): number {
  if (typeof min === "number") n = Math.max(min, n);
  if (typeof max === "number") n = Math.min(max, n);
  return n;
}

export function NumberField({
  value, onChange, defaultValue, min, max,
  allowNull, onNull,
  className, disabled,
  "aria-label": ariaLabel,
}: Props) {
  const [text, setText] = useState<string>(() =>
    value === defaultValue || value === 0 ? "" : String(value),
  );
  // If the parent flips the value (e.g. via "start over"), resync our
  // buffer. Ignore changes that originate from our own typing.
  const lastSentRef = useRef<number>(value);
  useEffect(() => {
    if (value !== lastSentRef.current) {
      setText(value === defaultValue || value === 0 ? "" : String(value));
    }
  }, [value, defaultValue]);

  function commit(raw: string) {
    const next = raw.replace(/[^\d]/g, "");
    setText(next);
    if (next === "") {
      if (allowNull) { onNull?.(); return; }
      lastSentRef.current = defaultValue;
      onChange(defaultValue);
      return;
    }
    const parsed = parseInt(next, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = clampRange(parsed, min, max);
    lastSentRef.current = clamped;
    onChange(clamped);
    // Mirror clamp back into the visible buffer so the user sees the
    // adjusted value instantly.
    if (clamped !== parsed) setText(String(clamped));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      pattern="[0-9]*"
      className={className ?? "field-input"}
      placeholder={String(defaultValue)}
      value={text}
      onChange={(e) => commit(e.target.value)}
      onFocus={(e) => e.target.select()}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}
