"use client";

import { BELT_LABEL, type WizardBundle, type WizardContact } from "./types";

interface Props {
  contact: WizardContact;
  bundle: WizardBundle;
  sizeBytes: number;
  maxBytes: number;
}

export function StepReview({ contact, bundle, sizeBytes, maxBytes }: Props) {
  return (
    <div className="wizard-step">
      <p className="step-intro">
        Revisa que todo esté bien. Al enviar, la solicitud queda en cola
        para que el operador la apruebe.
      </p>

      <div className="review-grid">
        <ReviewCard title="Contacto">
          <Row k="Email" v={contact.email} />
          {contact.org && <Row k="Organización" v={contact.org} />}
          {contact.tournamentDate && <Row k="Fecha" v={contact.tournamentDate} />}
          {contact.notes && <Row k="Notas" v={contact.notes} />}
        </ReviewCard>

        <ReviewCard title="Ajustes">
          <Row k="Áreas" v={String(bundle.settings.areaCount)} />
          <Row k="Disciplina" v={bundle.settings.disciplineMode} />
          <Row k="Tamaño llave" v={String(bundle.settings.subcategorySize)} />
          <Row k="Diferencia pts" v={String(bundle.settings.pointDifference ?? 0)} />
        </ReviewCard>

        <ReviewCard title="Logo">
          {bundle.logoDataUrl ? (
            <img
              src={bundle.logoDataUrl}
              alt="logo"
              style={{
                width: 96, height: 96, objectFit: "contain",
                background: "color-mix(in oklab, var(--color-fg) 4%, transparent)",
                border: "1px solid var(--color-line)", borderRadius: 4,
              }}
            />
          ) : <span className="muted">Sin logo</span>}
        </ReviewCard>

        <ReviewCard title={`Categorías (${bundle.categoryDefs.length})`}>
          {bundle.categoryDefs.length === 0 ? <span className="muted">— ninguna —</span> :
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {bundle.categoryDefs.map((c) => (
                <li key={c.id} className="small">
                  <strong>{c.name}</strong>
                  <span className="muted"> · {c.belts.map((b) => BELT_LABEL[b]).join(", ")} · {c.minAge}{c.maxAge ? `–${c.maxAge}` : "+"}</span>
                </li>
              ))}
            </ul>
          }
        </ReviewCard>

        <ReviewCard title="Competidores">
          <div className="code-display" style={{ marginBottom: 8 }}>
            <span className="digit">{bundle.participants.length}</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Cargados desde el formulario manual y/o CSV importado.
          </p>
        </ReviewCard>

        <ReviewCard title="Tamaño bundle">
          <Row k="Actual" v={`${Math.round(sizeBytes / 1024)} KB`} />
          <Row k="Máximo" v={`${Math.round(maxBytes / 1024)} KB`} />
          <div style={{ marginTop: 8, height: 8, background: "var(--color-line)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, Math.round((sizeBytes / maxBytes) * 100))}%`,
              background: sizeBytes > maxBytes * 0.8 ? "#f59e0b" : "var(--color-success)",
              transition: "width 200ms",
            }} />
          </div>
        </ReviewCard>
      </div>
    </div>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-eyebrow">{title.toUpperCase()}</span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span className="muted small mono" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{k}</span>
      <span className="mono small" style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}
