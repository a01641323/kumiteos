"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface BundleMetaRow {
  label: string | null;
  preparedAt: string | null;
  participantCount: number;
  categoryCount: number;
  hasLogo: boolean;
  sizeBytes: number;
  storedAt: number;
}

export interface CodeRow {
  codeId: string;
  status: "unused" | "used" | "revoked";
  createdAt: number;
  expiresAt: number;
  activatedAt: number | null;
  ttlHours: number;
  machineFingerprint: string | null;
  email: string | null;
  org: string | null;
  tournamentDate: string | null;
  bundle: BundleMetaRow | null;
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function pillForStatus(row: CodeRow, now: number) {
  if (row.status === "revoked") return { cls: "pill-revoked", label: "Revocado" };
  if (row.expiresAt <= now) return { cls: "pill-expired", label: "Vencido" };
  if (row.status === "used") return { cls: "pill-used", label: "Activo" };
  return { cls: "pill-unused", label: "Sin usar" };
}

export function CodesTable({ rows }: { rows: CodeRow[] }) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function revoke(codeId: string) {
    if (busy) return;
    if (!confirm("¿Revocar este código? Si está activado, la sesión se corta inmediatamente.")) return;
    setBusy(codeId);
    try {
      const r = await fetch(`/api/admin/codes/${encodeURIComponent(codeId)}/revoke`, {
        method: "POST",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(`No se pudo revocar: ${j.error ?? r.status}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  // Replace-bundle flow: a hidden <input type=file> per row would be
  // verbose; instead we use one shared input and remember which row
  // launched it. When the file is parsed + validated, PUT it.
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingReplaceCodeId = useRef<string | null>(null);

  function openReplacePicker(codeId: string) {
    if (busy) return;
    pendingReplaceCodeId.current = codeId;
    fileRef.current?.click();
  }

  async function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const codeId = pendingReplaceCodeId.current;
    pendingReplaceCodeId.current = null;
    if (!file || !codeId) return;
    setBusy(codeId);
    try {
      const text = await file.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { alert("Bundle inválido: no es JSON"); return; }
      if (!parsed || typeof parsed !== "object" || (parsed as { bundleVersion?: unknown }).bundleVersion !== 1) {
        alert("Bundle inválido: bundleVersion debe ser 1");
        return;
      }
      const r = await fetch(`/api/admin/codes/${encodeURIComponent(codeId)}/bundle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle: parsed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j.error === "already_activated") {
          alert("Este código ya fue activado — el bundle no se puede reemplazar.");
        } else {
          alert(`No se pudo reemplazar: ${j.detail ?? j.error ?? r.status}`);
        }
      } else {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  function fmtBundle(b: BundleMetaRow | null) {
    if (!b) return null;
    const parts: string[] = [];
    parts.push(`${b.participantCount}p`);
    parts.push(`${b.categoryCount}c`);
    if (b.hasLogo) parts.push("logo");
    parts.push(`${Math.round(b.sizeBytes / 1024)}KB`);
    return parts.join(" · ");
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={onReplaceFile}
        style={{ display: "none" }}
      />
      <table className="admin-table codes-table">
        <thead>
          <tr>
            <th>Estado</th>
            <th>Email · Organización</th>
            <th>Tiempo restante</th>
            <th>Bundle</th>
            <th>Emitido</th>
            <th>Activado</th>
            <th>codeId</th>
            <th style={{ textAlign: "right" }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pill = pillForStatus(row, now);
            const remaining = row.expiresAt - now;
            const canRevoke = row.status !== "revoked" && row.expiresAt > now;
            const canReplaceBundle = row.status === "unused";
            const bundleLine = fmtBundle(row.bundle);
            return (
              <tr key={row.codeId}>
                <td>
                  <span className={`status-pill ${pill.cls}`}>{pill.label}</span>
                </td>
                <td>
                  <div>{row.email ?? "—"}</div>
                  <div className="muted small">
                    {row.org ?? "sin organización"}
                    {row.tournamentDate ? ` · ${row.tournamentDate}` : ""}
                  </div>
                </td>
                <td className="mono">{fmtRemaining(remaining)}</td>
                <td>
                  {row.bundle ? (
                    <div>
                      <div className="small" title={row.bundle.label ?? undefined}>
                        📦 {row.bundle.label ? (row.bundle.label.length > 24 ? `${row.bundle.label.slice(0, 22)}…` : row.bundle.label) : "adjuntado"}
                      </div>
                      <div className="muted small mono">{bundleLine}</div>
                    </div>
                  ) : (
                    <span className="muted small">— ninguno —</span>
                  )}
                  {canReplaceBundle ? (
                    <div style={{ marginTop: 4 }}>
                      <button
                        className="btn-row"
                        onClick={() => openReplacePicker(row.codeId)}
                        disabled={busy === row.codeId}
                        title="Reemplazar el bundle adjunto (sólo antes de la activación)"
                      >
                        {busy === row.codeId ? "…" : row.bundle ? "Reemplazar" : "Adjuntar"}
                      </button>
                    </div>
                  ) : null}
                </td>
                <td className="muted small">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="muted small">
                  {row.activatedAt ? new Date(row.activatedAt).toLocaleString() : "—"}
                </td>
                <td className="mono small muted">{row.codeId}</td>
                <td style={{ textAlign: "right" }}>
                  {canRevoke ? (
                    <button
                      className="btn-row danger"
                      onClick={() => revoke(row.codeId)}
                      disabled={busy === row.codeId}
                    >
                      {busy === row.codeId ? "…" : "Revocar"}
                    </button>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
