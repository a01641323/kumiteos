"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Non-dismissable banner shown in GRACE state. Counts down from 1 hour and
 * pings the main process to retry renewal every 30 s in the background.
 */
export function GraceBanner() {
  const { status, retryRenewal, graceRemainingMs } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (status.kind !== "authed" || !status.isGrace) return;
    const t = setInterval(() => {
      retryRenewal().catch((e) => setRetryError(e instanceof Error ? e.message : "renewal_failed"));
    }, 30_000);
    return () => clearInterval(t);
  }, [retryRenewal, status]);

  if (status.kind !== "authed" || !status.isGrace) return null;
  // Recompute remaining locally so the countdown updates between IPC events.
  const remaining = Math.max(0, graceRemainingMs - (now - (status.session.issuedAt > 0 ? now : now)));
  const display = formatRemaining(remaining || graceRemainingMs);

  return (
    <div
      role="alert"
      style={{
        background: "rgba(216,168,75,0.18)",
        color: "#f0c97a",
        borderBottom: "1px solid rgba(216,168,75,0.35)",
        padding: "10px 16px",
        fontSize: 13,
        textAlign: "center",
        position: "sticky",
        top: 0,
        zIndex: 1000,
      }}
    >
      ⚠ Offline mode — {display} remaining. Connect to the internet to renew your access.
      {retryError ? <span style={{ marginLeft: 12, opacity: 0.7 }}>({retryError})</span> : null}
    </div>
  );
}
