"use client";

import { useEffect, useState } from "react";
import { useNetwork } from "@/lib/network-context";
import type { PendingConnection } from "@/lib/api-client";

export function ConnectionRequestModal() {
  const { status, isElectron } = useNetwork();
  const [queue, setQueue] = useState<PendingConnection[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  // Subscribe to incoming connection requests AND to pending list updates
  // (in case the modal mounts after a request was already queued by the
  // main process — e.g. the user reloads while a guest is waiting).
  useEffect(() => {
    if (!isElectron) return;
    const net = window.__KARATE__?.network;
    if (!net) return;
    const append = (reqs: PendingConnection[]) => {
      setQueue((prev) => {
        const known = new Set(prev.map((q) => q.clientId));
        const next = [...prev];
        for (const r of reqs) {
          if (!r?.clientId || known.has(r.clientId)) continue;
          known.add(r.clientId);
          next.push(r);
        }
        return next;
      });
    };
    net.listPending().then((list) => append(list)).catch(() => {});
    const offReq = net.onConnectionRequest((r) => append([r]));
    const offStatus = net.onStatus((s) => {
      // If the server tells us a clientId is no longer pending (timed out,
      // disconnected, approved, or rejected), drop it from the queue.
      const stillPending = new Set((s.pending || []).map((p) => p.clientId));
      setQueue((prev) => prev.filter((q) => stillPending.has(q.clientId)));
    });
    return () => { offReq(); offStatus(); };
  }, [isElectron]);

  // Only host (server mode) sees the modal.
  if (!isElectron || status.mode !== "server") return null;
  const current = queue[0];
  if (!current) return null;

  async function decide(approve: boolean) {
    const net = window.__KARATE__?.network;
    if (!net) return;
    setDecidingId(current.clientId);
    try {
      if (approve) await net.approveConnection(current.clientId);
      else await net.rejectConnection(current.clientId, "denied");
    } finally {
      setQueue((prev) => prev.filter((q) => q.clientId !== current.clientId));
      setDecidingId(null);
    }
  }

  return (
    <div className="jury-overlay" role="dialog" aria-modal="true" aria-label="Connection request">
      <div className="jury-modal" style={{ maxWidth: 460 }}>
        <h2>Solicitud de conexión</h2>
        <div className="jury-subtitle" style={{ marginBottom: 22 }}>
          {queue.length > 1 ? `1 de ${queue.length} pendientes` : "Un equipo quiere unirse"}
        </div>

        <div style={{ marginBottom: 26 }}>
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 20,
              fontWeight: 600,
              color: "var(--color-fg)",
              letterSpacing: "-0.01em",
            }}
          >
            {current.hostname}
          </div>
          <div
            style={{
              marginTop: 6,
              color: "var(--color-fg-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {current.ip}
          </div>
        </div>

        <div className="jury-buttons">
          <button
            type="button"
            className="jury-btn"
            onClick={() => decide(false)}
            disabled={decidingId === current.clientId}
          >
            <span className="pre">Esc</span>
            Rechazar
          </button>
          <button
            type="button"
            className="jury-btn jury-btn-red"
            onClick={() => decide(true)}
            disabled={decidingId === current.clientId}
          >
            <span className="pre">Enter</span>
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
