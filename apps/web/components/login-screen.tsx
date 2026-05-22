"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { DiscoveredServer } from "@/lib/api-client";
import { GuestWaitingScreen } from "./guest-waiting-screen";

const ERROR_COPY: Record<string, string> = {
  CODE_NOT_FOUND: "This code does not exist. Check for typos.",
  CODE_EXPIRED: "This code has expired. Please contact support for a new one.",
  CODE_ALREADY_USED: "This code has already been activated on another device.",
  MACHINE_ALREADY_REGISTERED: "This device is already linked to a different access code. Contact support to transfer your license.",
  RATE_LIMITED: "Too many attempts. Please wait 15 minutes before trying again.",
  ACCESS_REVOKED: "This license has been revoked. Contact support.",
  INVALID_FINGERPRINT: "Could not identify this device.",
  LOCAL_VERIFY_FAILED: "Server returned a token we could not verify. Contact support.",
};

const JOIN_ERROR_COPY: Record<string, string> = {
  denied: "The host rejected the connection.",
  timeout: "The host did not respond in time.",
  kicked: "You were disconnected by the host.",
  host_unlicensed: "The host needs to activate its license before guests can join.",
  connect_failed: "Could not reach the host. Check the IP and that the host is running.",
  network_unavailable: "Network features are only available in the desktop app.",
  set_mode_failed: "Could not switch to client mode.",
};

type JoinTarget = { serverId: string | null; ip: string; port: number; label: string };

export function LoginScreen() {
  const { login, joinAsGuest } = useAuth();
  const isElectron =
    typeof window !== "undefined" && !!window.__KARATE__?.network;

  // ── activation form ──
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── join-host section ──
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [joining, setJoining] = useState<JoinTarget | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Poll for discovered hosts while this screen is mounted. The desktop
  // listener runs in standalone + client modes, so the list stays warm
  // even before the user clicks anything.
  useEffect(() => {
    if (!isElectron) return;
    const net = window.__KARATE__?.network;
    if (!net) return;
    let cancelled = false;
    const refresh = () => {
      net.listDiscoveredServers().then((list) => {
        if (!cancelled) setDiscovered(list);
      }).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isElectron]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a 6-digit code.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(code);
    } catch (err) {
      const c = err instanceof Error ? err.message : "unknown_error";
      setError(ERROR_COPY[c] ?? "Could not connect to the activation server. Check your internet connection.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
  }

  const startJoin = useCallback(async (target: JoinTarget) => {
    setJoinError(null);
    setJoining(target);
    try {
      await joinAsGuest(target.serverId
        ? target.serverId
        : { ip: target.ip, port: target.port });
    } catch (err) {
      const c = err instanceof Error ? err.message : "connect_failed";
      setJoinError(JOIN_ERROR_COPY[c] ?? `Could not join: ${c}`);
      setJoining(null);
    }
  }, [joinAsGuest]);

  function onJoinDiscovered(s: DiscoveredServer) {
    startJoin({
      serverId: s.serverId,
      ip: s.serverIp,
      port: s.serverPort,
      label: s.tournamentName || s.serverIp,
    });
  }

  if (joining) {
    return (
      <GuestWaitingScreen
        target={joining}
        onCancel={() => setJoining(null)}
      />
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h1>Karate Tournament</h1>
          <p className="muted">Enter your 6-digit access code</p>
          <input
            autoFocus
            value={code}
            onChange={handleChange}
            placeholder="000000"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            style={{
              textAlign: "center",
              letterSpacing: 10,
              fontSize: 28,
              width: "100%",
              fontFamily: "ui-monospace, Menlo, monospace",
            }}
            disabled={submitting}
          />
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="primary" disabled={submitting || code.length !== 6}>
            {submitting ? "Activating…" : "Activate"}
          </button>
        </form>

        {isElectron && (
          <div style={{ marginTop: 8 }}>
            <div
              aria-hidden
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: "18px 0 10px",
                color: "var(--muted, #8a93a6)",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              <div style={{ flex: 1, height: 1, background: "var(--border, #2a3142)" }} />
              <span>or join a host</span>
              <div style={{ flex: 1, height: 1, background: "var(--border, #2a3142)" }} />
            </div>

            {joinError && <div className="auth-error" style={{ marginBottom: 10 }}>{joinError}</div>}

            {discovered.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {discovered.map((s) => (
                  <li
                    key={s.serverId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "10px 12px",
                      background: "var(--panel-2, #1d2230)",
                      border: "1px solid var(--border, #2a3142)",
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {s.tournamentName || "Karate Host"}
                      </div>
                      <div className="muted small" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                        {s.serverIp}:{s.serverPort}
                      </div>
                    </div>
                    <button type="button" className="primary" onClick={() => onJoinDiscovered(s)}>
                      Connect
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Looking for hosts on your network…
              </p>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
