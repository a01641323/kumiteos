"use client";

import { useCallback, useEffect, useState } from "react";
import type { LicenseDegradedReason } from "@karate/core";
import type { DiscoveredServer } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { GuestWaitingScreen } from "./guest-waiting-screen";

const REASON_COPY: Record<LicenseDegradedReason, { title: string; body: string }> = {
  EXPIRED: {
    title: "License expired",
    body: "Your license has expired. Enter a new access code below or contact your administrator to renew.",
  },
  REVOKED: {
    title: "Access revoked",
    body: "This license has been revoked. If you believe this is a mistake, contact your administrator.",
  },
  MACHINE_MISMATCH: {
    title: "Device not recognized",
    body: "This license is registered to a different device. Ask your administrator to transfer it, then enter the original code.",
  },
  CLOCK_TAMPER: {
    title: "Clock error",
    body: "Your system clock appears to have moved backward. Set the correct date and time, then restart the app.",
  },
  INVALID_SIGNATURE: {
    title: "Invalid license",
    body: "Your license file failed verification. Enter a new access code below to reactivate.",
  },
  STORAGE_CORRUPTED: {
    title: "License storage corrupted",
    body: "We could not read the locally-cached license. Enter your access code below to reactivate.",
  },
};

type JoinTarget = { serverId: string | null; ip: string; port: number; label: string };

const JOIN_ERROR_COPY: Record<string, string> = {
  denied: "The host rejected the connection.",
  timeout: "The host did not respond in time.",
  host_unlicensed: "The host needs to activate its license before guests can join.",
  connect_failed: "Could not reach the host. Check the IP and that the host is running.",
  network_unavailable: "Network features are only available in the desktop app.",
  set_mode_failed: "Could not switch to client mode.",
};

export function LockScreen({ reason }: { reason: LicenseDegradedReason | string }) {
  const { redeemCode, joinAsGuest } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const isElectron = typeof window !== "undefined" && !!window.__KARATE__?.network;
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("4747");
  const [joining, setJoining] = useState<JoinTarget | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

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

  const startJoin = useCallback(async (target: JoinTarget) => {
    setJoinError(null);
    setJoining(target);
    try {
      await joinAsGuest(target.serverId ? target.serverId : { ip: target.ip, port: target.port });
    } catch (err) {
      const c = err instanceof Error ? err.message : "connect_failed";
      setJoinError(JOIN_ERROR_COPY[c] ?? `Could not join: ${c}`);
      setJoining(null);
    }
  }, [joinAsGuest]);

  async function handleReset() {
    const license = typeof window !== "undefined" ? window.__KARATE__?.license : null;
    if (!license) return;
    setResetting(true);
    try { await license.reset(); } finally { setResetting(false); }
  }

  const info = REASON_COPY[reason as LicenseDegradedReason] ?? {
    title: "Access restricted",
    body: typeof reason === "string" ? reason : "Unknown reason.",
  };

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a 6-digit code.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await redeemCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not activate");
    } finally {
      setLoading(false);
    }
  }

  if (joining) {
    return <GuestWaitingScreen target={joining} onCancel={() => setJoining(null)} />;
  }

  return (
    <div className="auth-screen">
      <div className="auth-card auth-locked">
        <h1>{info.title}</h1>
        <p>{info.body}</p>
        <form onSubmit={handleRedeem} style={{ marginTop: 18 }}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            Have a new access code? Enter it here to reactivate.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            style={{
              textAlign: "center",
              letterSpacing: 8,
              fontSize: 22,
              width: "100%",
              marginBottom: 10,
              fontFamily: "ui-monospace, Menlo, monospace",
            }}
          />
          {error && <p style={{ color: "var(--red, #e05252)", marginBottom: 8, fontSize: 13 }}>{error}</p>}
          <button type="submit" className="primary" disabled={loading || code.length !== 6} style={{ width: "100%" }}>
            {loading ? "Activating…" : "Reactivate"}
          </button>
        </form>

        {isElectron && (
          <>
            <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 10px", color: "var(--muted, #8a93a6)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border, #2a3142)" }} />
              <span>or join a host</span>
              <div style={{ flex: 1, height: 1, background: "var(--border, #2a3142)" }} />
            </div>

            {joinError && <div className="auth-error" style={{ marginBottom: 10 }}>{joinError}</div>}

            {discovered.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {discovered.map((s) => (
                  <li key={s.serverId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", background: "var(--panel-2, #1d2230)", border: "1px solid var(--border, #2a3142)", borderRadius: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{s.tournamentName || "Karate Host"}</div>
                      <div className="muted small" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{s.serverIp}:{s.serverPort}</div>
                    </div>
                    <button type="button" className="primary" onClick={() => startJoin({ serverId: s.serverId, ip: s.serverIp, port: s.serverPort, label: s.tournamentName || s.serverIp })}>
                      Connect
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>Looking for hosts on your network…</p>
            )}

            <div style={{ marginTop: 14 }}>
              {!manualOpen ? (
                <button type="button" onClick={() => { setManualOpen(true); setJoinError(null); }} style={{ background: "transparent", border: "none", color: "var(--accent, #4f8cff)", cursor: "pointer", padding: 0, fontSize: 13 }}>
                  Enter IP manually
                </button>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); const ip = manualIp.trim(); const port = Number(manualPort) || 4747; if (!/^[0-9.]+$/.test(ip)) { setJoinError("Enter a valid IPv4 address."); return; } startJoin({ serverId: null, ip, port, label: `${ip}:${port}` }); }} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <label style={{ flex: "2 1 160px" }}>
                    IP address
                    <input autoFocus value={manualIp} onChange={(e) => setManualIp(e.target.value)} placeholder="192.168.1.10" inputMode="decimal" />
                  </label>
                  <label style={{ flex: "1 1 80px", maxWidth: 100 }}>
                    Port
                    <input value={manualPort} onChange={(e) => setManualPort(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" />
                  </label>
                  <button type="submit" className="primary">Connect</button>
                  <button type="button" onClick={() => { setManualOpen(false); setManualIp(""); }} style={{ background: "transparent", border: "none", color: "var(--muted, #8a93a6)", cursor: "pointer", padding: "8px 4px", fontSize: 13 }}>Cancel</button>
                </form>
              )}
            </div>

            <div style={{ marginTop: 18, borderTop: "1px solid var(--border, #2a3142)", paddingTop: 14 }}>
              <button type="button" onClick={handleReset} disabled={resetting} style={{ background: "transparent", border: "none", color: "var(--muted, #8a93a6)", cursor: "pointer", padding: 0, fontSize: 12 }}>
                {resetting ? "Clearing…" : "Clear stored license and start over"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
