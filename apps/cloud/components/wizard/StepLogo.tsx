"use client";

import { LogoPicker } from "./LogoPicker";

interface Props {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}

export function StepLogo({ value, onChange, disabled }: Props) {
  return (
    <div className="wizard-step">
      <p className="step-intro">
        Subir un logo es opcional pero recomendado — se muestra en los
        marcadores y la pantalla pública durante el torneo.
      </p>
      {disabled ? (
        value ? (
          <img
            src={value}
            alt="logo"
            style={{ width: 128, height: 128, objectFit: "contain", border: "1px solid var(--color-line)", borderRadius: 4 }}
          />
        ) : (
          <p className="muted">Sin logo.</p>
        )
      ) : (
        <LogoPicker value={value} onChange={onChange} />
      )}
    </div>
  );
}
