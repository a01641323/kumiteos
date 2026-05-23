"use client";

import { useRef, useState, useTransition } from "react";
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
 * Approve a pending request. Two-step flow:
 *   click → file input → user picks a tournament-bundle JSON (or
 *   cancels) → second click confirms and submits.
 *
 * Cancelling the file picker still approves the request — same as the
 * legacy single-button grant, but without a preloaded bundle.
 */
export function GrantButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [stagedBundle, setStagedBundle] = useState<unknown | null>(null);
  const [stagedName, setStagedName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function pickFile() {
    setError(null);
    fileRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same name later
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || parsed.bundleVersion !== 1) {
        throw new Error("Not a v1 tournament bundle");
      }
      setStagedBundle(parsed);
      setStagedName(file.name);
    } catch (err) {
      setError(`Bundle inválido: ${(err as Error).message}`);
      setStagedBundle(null);
      setStagedName("");
    }
  }

  function submit(withBundle: boolean) {
    start(async () => {
      try {
        await call(`/api/admin/requests/${id}/grant`, withBundle ? { bundle: stagedBundle } : null);
        setStagedBundle(null);
        setStagedName("");
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={onFileChosen}
        style={{ display: "none" }}
      />

      {stagedBundle ? (
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span className="muted small" title={stagedName}>📦 {stagedName.length > 24 ? `${stagedName.slice(0, 22)}…` : stagedName}</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(true)}
            className="btn-row"
            style={{ borderColor: "rgba(22, 163, 74, 0.5)", color: "#4ade80" }}
          >
            {pending ? "…" : "Aprobar con bundle"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => { setStagedBundle(null); setStagedName(""); }}
            className="btn-row"
          >
            ×
          </button>
        </div>
      ) : (
        <div style={{ display: "inline-flex", gap: 6 }}>
          <button
            type="button"
            disabled={pending}
            onClick={pickFile}
            className="btn-row"
            title="Adjuntar bundle JSON antes de aprobar"
          >
            📦
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(false)}
            className="btn-row"
            style={{ borderColor: "rgba(22, 163, 74, 0.5)", color: "#4ade80" }}
          >
            {pending ? "…" : "Aprobar"}
          </button>
        </div>
      )}

      {error ? <span className="small" style={{ color: "#f87171", maxWidth: 280, textAlign: "right" }}>{error}</span> : null}
    </div>
  );
}

export function RejectButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const reason = window.prompt("Optional rejection reason (visible to requester):") ?? "";
          await call(`/api/admin/requests/${id}/reject`, reason ? { reason } : {});
          router.refresh();
        })
      }
      className="btn-row danger"
    >
      {pending ? "…" : "Rechazar"}
    </button>
  );
}
