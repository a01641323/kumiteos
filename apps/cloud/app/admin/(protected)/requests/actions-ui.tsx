"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

async function call(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const detail = j?.detail || j?.error || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

/**
 * Approve a pending request. Single click — the bundle, if any, was
 * already attached by the client during their wizard flow and is
 * stored under bundle:byRequestId:<id>. The grant route reads it,
 * stores it under the new code's key, and deletes the draft.
 */
export function GrantButton({ id, hasBundle, primary }: { id: string; hasBundle: boolean; primary?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await call(`/api/admin/requests/${id}/grant`);
            router.refresh();
          } catch (err) {
            alert(`No se pudo aprobar: ${(err as Error).message}`);
          }
        })
      }
      className={primary ? "btn primary" : "btn-row"}
      style={primary ? undefined : { borderColor: "rgba(22, 163, 74, 0.5)", color: "#4ade80" }}
      title={hasBundle ? "Aprobar y entregar bundle" : "Aprobar sin bundle (legacy)"}
    >
      {pending ? "…" : hasBundle ? "Aprobar y entregar bundle" : "Aprobar (sin bundle)"}
    </button>
  );
}

export function RejectButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const reason = window.prompt("Motivo opcional (visible para el solicitante):") ?? "";
          try {
            await call(`/api/admin/requests/${id}/reject`, reason ? { reason } : {});
            router.refresh();
          } catch (err) {
            alert(`No se pudo rechazar: ${(err as Error).message}`);
          }
        })
      }
      className="btn-row danger"
    >
      {pending ? "…" : "Rechazar"}
    </button>
  );
}
