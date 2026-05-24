"use client";

// Wizard — top-level client component for the 6-step request flow.
//
// Step 1 (Contact) POSTs /api/request on Next, which sets the
// karate.request cookie and returns { requestId, accessToken }.
// Subsequent Next clicks PUT /api/request/<id>/bundle so the in-
// progress bundle is autosaved server-side and survives reloads.
// Step 6 POSTs /api/request/<id>/submit which flips status to
// "pending" and puts the request in the admin queue.
//
// The component is fully self-contained: the parent server page just
// passes the hydrated snapshot (loaded from /api/request/me on the
// server) — or nothing for a fresh wizard.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Arrow, Footer, TopBar } from "@/components/chrome";
import {
  STEPS, type StepKey, type WizardBundle, type WizardContact, type WizardSnapshot,
  emptyBundle, emptyContact,
} from "./types";
import { StepContact } from "./StepContact";
import { StepSettings } from "./StepSettings";
import { StepLogo } from "./StepLogo";
import { StepCategories } from "./StepCategories";
import { StepParticipants } from "./StepParticipants";
import { StepReview } from "./StepReview";

const MAX_BUNDLE_BYTES = 600 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  initial?: WizardSnapshot | null;
}

export function Wizard({ initial }: Props) {
  const [requestId, setRequestId] = useState<string | null>(initial?.requestId ?? null);
  const [status, setStatus] = useState<WizardSnapshot["status"]>(initial?.status ?? "draft");
  const [rejectionReason, setRejectionReason] = useState<string | null>(initial?.rejectionReason ?? null);
  const [grantedCode, setGrantedCode] = useState<string | null>(initial?.rawCode ?? null);
  const [contact, setContact] = useState<WizardContact>(initial?.contact ?? emptyContact());
  const [bundle, setBundle] = useState<WizardBundle>(initial?.bundle ?? emptyBundle());

  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const locked = status === "pending" || status === "granted";

  // ---- byte size (client-side estimate, server is authoritative)
  const sizeBytes = useMemo(() => {
    try { return new Blob([JSON.stringify(bundle)]).size; }
    catch { return 0; }
  }, [bundle]);
  const overBudget = sizeBytes > MAX_BUNDLE_BYTES;

  // ---- debounced autosave for step transitions (extra safety on top of explicit Next save)
  const lastSaved = useRef<string>(JSON.stringify(bundle));
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!requestId || locked) return;
    const cur = JSON.stringify(bundle);
    if (cur === lastSaved.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      try {
        setSaveState("saving");
        const r = await fetch(`/api/request/${requestId}/bundle`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundle }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.detail || j.error || `HTTP ${r.status}`);
        }
        lastSaved.current = cur;
        setSaveState("saved");
      } catch (err) {
        setSaveState("idle");
        setGlobalError(`Autoguardado falló: ${(err as Error).message}`);
      }
    }, 1500);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [bundle, requestId, locked]);

  // ---- step navigation
  const cur = STEPS[stepIndex];

  async function gotoNext() {
    setGlobalError(null);
    if (cur.key === "contact") {
      if (!EMAIL_RE.test(contact.email.trim())) {
        setGlobalError("Correo electrónico inválido.");
        return;
      }
      if (!requestId) {
        // first time — create the draft
        setBusy(true);
        try {
          const r = await fetch("/api/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(contact),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || `HTTP ${r.status}`);
          }
          const j = (await r.json()) as { requestId: string };
          setRequestId(j.requestId);
        } catch (err) {
          setGlobalError(`No se pudo crear la solicitud: ${(err as Error).message}`);
          setBusy(false);
          return;
        } finally {
          setBusy(false);
        }
      } else {
        // contact edits on a returning draft → patch
        try {
          await fetch(`/api/request/${requestId}/bundle`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contact }),
          });
        } catch { /* non-fatal */ }
      }
    }

    if (cur.key !== "review") {
      // Force a save before advancing
      if (requestId && !locked) await flushSave();
      setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
    }
  }

  async function flushSave() {
    if (!requestId) return;
    const cur = JSON.stringify(bundle);
    if (cur === lastSaved.current) return;
    setSaveState("saving");
    try {
      const r = await fetch(`/api/request/${requestId}/bundle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      }
      lastSaved.current = cur;
      setSaveState("saved");
    } catch (err) {
      setSaveState("idle");
      setGlobalError(`Autoguardado falló: ${(err as Error).message}`);
      throw err;
    }
  }

  function gotoBack() {
    setGlobalError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  async function submit() {
    if (!requestId) { setGlobalError("No hay solicitud activa."); return; }
    if (overBudget) { setGlobalError("El bundle excede 600 KB."); return; }
    if (bundle.categoryDefs.length === 0) { setGlobalError("Define al menos una categoría."); return; }
    if (bundle.participants.length === 0) { setGlobalError("Agrega al menos un competidor."); return; }
    setBusy(true);
    try {
      await flushSave();
      const r = await fetch(`/api/request/${requestId}/submit`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      }
      setStatus("pending");
    } catch (err) {
      setGlobalError(`No se pudo enviar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    if (!requestId) return;
    if (!confirm("¿Eliminar este borrador y empezar de cero?")) return;
    setBusy(true);
    try {
      await fetch(`/api/request/${requestId}`, { method: "DELETE" });
      setRequestId(null);
      setStatus("draft");
      setRejectionReason(null);
      setGrantedCode(null);
      setContact(emptyContact());
      setBundle(emptyBundle());
      setStepIndex(0);
      setGlobalError(null);
      lastSaved.current = JSON.stringify(emptyBundle());
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    // Rejected → re-enter edit. The /submit endpoint will re-flip
    // rejected → pending on next submit; here we just unlock the UI.
    setStatus("draft");
    setRejectionReason(null);
  }

  // Poll for granted code while pending
  useEffect(() => {
    if (status !== "pending" || !requestId) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/request/me", { cache: "no-store" });
        if (!alive || !r.ok) return;
        const j = await r.json();
        if (j?.request?.status === "granted") {
          setStatus("granted");
          setGrantedCode(j.request.rawCode ?? null);
        } else if (j?.request?.status === "rejected") {
          setStatus("rejected");
          setRejectionReason(j.request.rejectionReason ?? null);
        }
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [status, requestId]);

  return (
    <div>
      <TopBar />

      <section className="section">
        <div className="section-head">
          <div className="section-num">02</div>
          <div className="section-titles">
            <h2 className="section-title">Solicitar código</h2>
            <p className="section-sub">
              Construye tu torneo: ajustes, logo, categorías y competidores.
              Al enviar, el operador lo aprueba y recibes tu código.
            </p>
          </div>
          <div className="section-meta">
            {STEPS[stepIndex].label.toUpperCase()} · {stepIndex + 1}/{STEPS.length}
          </div>
        </div>

        {/* Banners by status */}
        {status === "pending" && <PendingBanner code={grantedCode} />}
        {status === "granted" && grantedCode && <GrantedBanner code={grantedCode} />}
        {status === "rejected" && (
          <div className="card" style={{ borderColor: "color-mix(in oklab, var(--color-accent) 50%, var(--color-line))", marginBottom: 16 }}>
            <div className="card-head">
              <span className="card-eyebrow">RECHAZADO</span>
              {!locked && (
                <button type="button" className="btn-row" onClick={reopen}>Editar y reenviar</button>
              )}
            </div>
            <p>{rejectionReason ?? "El operador rechazó la solicitud sin dejar motivo."}</p>
          </div>
        )}

        {/* Progress chips */}
        <div className="wiz-chips">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              disabled={locked || (i > stepIndex && !requestId)}
              className={`wiz-chip ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}
              onClick={() => setStepIndex(i)}
            >
              <span className="wiz-chip-num">{String(i + 1).padStart(2, "0")}</span>
              <span className="wiz-chip-label">{s.label}</span>
            </button>
          ))}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <StepBody
            stepKey={cur.key}
            contact={contact}
            bundle={bundle}
            sizeBytes={sizeBytes}
            disabled={locked}
            onContact={setContact}
            onBundle={setBundle}
          />

          {globalError && <div className="error-banner" style={{ marginTop: 16 }}>{globalError}</div>}

          <div className="wiz-footer">
            <div className="wiz-meter">
              <span className="muted small mono">{Math.round(sizeBytes / 1024)} / {Math.round(MAX_BUNDLE_BYTES / 1024)} KB</span>
              <div className="meter-bar">
                <div
                  className="meter-fill"
                  style={{
                    width: `${Math.min(100, Math.round((sizeBytes / MAX_BUNDLE_BYTES) * 100))}%`,
                    background: overBudget ? "var(--color-accent)" : (sizeBytes > MAX_BUNDLE_BYTES * 0.8 ? "#f59e0b" : "var(--color-success)"),
                  }}
                />
              </div>
              {saveState === "saving" && <span className="muted small">guardando…</span>}
              {saveState === "saved" && <span className="muted small">guardado ✓</span>}
            </div>

            <div className="wiz-actions">
              {requestId && !locked && (
                <button type="button" className="btn-row" onClick={startOver}>Empezar de cero</button>
              )}
              <button type="button" className="btn ghost" disabled={busy || stepIndex === 0} onClick={gotoBack}>
                Atrás
              </button>
              {cur.key !== "review" ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || locked || overBudget}
                  onClick={gotoNext}
                >
                  {busy ? "…" : "Siguiente"} <Arrow />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || locked || overBudget}
                  onClick={submit}
                >
                  {busy ? "Enviando…" : "Enviar solicitud"} <Arrow />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function StepBody(props: {
  stepKey: StepKey;
  contact: WizardContact;
  bundle: WizardBundle;
  sizeBytes: number;
  disabled?: boolean;
  onContact: (v: WizardContact) => void;
  onBundle: (v: WizardBundle) => void;
}) {
  const { stepKey, contact, bundle, sizeBytes, disabled, onContact, onBundle } = props;
  switch (stepKey) {
    case "contact":
      return <StepContact value={contact} onChange={onContact} disabled={disabled} />;
    case "settings":
      return <StepSettings value={bundle.settings} onChange={(s) => onBundle({ ...bundle, settings: s })} disabled={disabled} />;
    case "logo":
      return <StepLogo value={bundle.logoDataUrl} onChange={(l) => onBundle({ ...bundle, logoDataUrl: l })} disabled={disabled} />;
    case "categories":
      return <StepCategories value={bundle.categoryDefs} onChange={(c) => onBundle({ ...bundle, categoryDefs: c })} disabled={disabled} />;
    case "participants":
      return <StepParticipants value={bundle.participants} onChange={(p) => onBundle({ ...bundle, participants: p })} disabled={disabled} />;
    case "review":
      return <StepReview contact={contact} bundle={bundle} sizeBytes={sizeBytes} maxBytes={MAX_BUNDLE_BYTES} />;
  }
}

function PendingBanner({ code }: { code: string | null }) {
  return (
    <div className="card" style={{ marginBottom: 16, borderColor: "color-mix(in oklab, var(--color-success) 30%, var(--color-line))" }}>
      <div className="card-head">
        <span className="card-eyebrow">EN REVISIÓN</span>
        <span className="card-status status-checking">Esperando aprobación</span>
      </div>
      <p style={{ margin: 0 }}>
        {code ? "Tu solicitud fue aprobada — ver código abajo." :
          "Tu solicitud está en cola. Esta página se actualiza sola; déjala abierta o vuelve más tarde."}
      </p>
    </div>
  );
}

function GrantedBanner({ code }: { code: string }) {
  return (
    <div className="card" style={{ marginBottom: 16, borderColor: "color-mix(in oklab, var(--color-success) 40%, var(--color-line))" }}>
      <div className="card-head">
        <span className="card-eyebrow">CÓDIGO DE ACTIVACIÓN</span>
        <span className="card-status status-success">✓ Aprobado</span>
      </div>
      <div className="code-display">
        {code.split("").map((d, i) => <span key={i} className="digit">{d}</span>)}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <Link href="/download" className="btn primary">
          Descargar la app <Arrow />
        </Link>
      </div>
    </div>
  );
}
