"use client";

import { useAuth } from "@/lib/auth-context";

interface Props {
  target: { ip: string; port: number; label: string };
  onCancel: () => void;
}

export function GuestWaitingScreen({ target, onCancel }: Props) {
  const { leaveGuest } = useAuth();

  async function handleCancel() {
    try { await leaveGuest(); } catch {}
    onCancel();
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ textAlign: "center", alignItems: "center" }}>
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "3px solid var(--border, #2a3142)",
            borderTopColor: "var(--accent, #4f8cff)",
            animation: "guest-spin 0.9s linear infinite",
            margin: "8px auto 4px",
          }}
        />
        <h1 style={{ fontSize: 18 }}>Waiting for host approval…</h1>
        <p className="muted small" style={{ margin: 0 }}>{target.label}</p>
        <p className="muted small" style={{ fontFamily: "ui-monospace, Menlo, monospace", margin: 0 }}>
          {target.ip}:{target.port}
        </p>
        <button type="button" onClick={handleCancel} style={{ marginTop: 18, width: "100%" }}>
          Cancel
        </button>
        <style>{`@keyframes guest-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
