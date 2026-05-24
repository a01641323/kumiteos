"use client";

import type { WizardContact } from "./types";

interface Props {
  value: WizardContact;
  onChange: (v: WizardContact) => void;
  disabled?: boolean;
  error?: string | null;
}

export function StepContact({ value, onChange, disabled, error }: Props) {
  function set<K extends keyof WizardContact>(k: K, v: WizardContact[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="wizard-step">
      <p className="step-intro">
        Para empezar, déjanos saber quién eres y cómo contactarte. Después
        podrás cargar los datos del torneo paso a paso.
      </p>

      <label className="field">
        <span className="field-label">Correo electrónico *</span>
        <input
          type="email"
          required
          value={value.email}
          onChange={(e) => set("email", e.target.value)}
          className="field-input"
          placeholder="tu@correo.com"
          autoComplete="email"
          disabled={disabled}
        />
      </label>

      <label className="field">
        <span className="field-label">Organización o dojo</span>
        <input
          value={value.org}
          onChange={(e) => set("org", e.target.value)}
          className="field-input"
          placeholder="Asociación, federación, dojo…"
          disabled={disabled}
        />
      </label>

      <label className="field">
        <span className="field-label">Fecha del torneo</span>
        <input
          type="date"
          value={value.tournamentDate}
          onChange={(e) => set("tournamentDate", e.target.value)}
          className="field-input"
          disabled={disabled}
        />
      </label>

      <label className="field">
        <span className="field-label">Notas</span>
        <textarea
          value={value.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="field-textarea"
          placeholder="Contexto opcional para el operador."
          disabled={disabled}
        />
      </label>

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
