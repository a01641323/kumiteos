"use client";

import { useCallback, useEffect, useState } from "react";
import { useNetwork } from "@/lib/network-context";
import type { DiscoveredServer, NetworkStatusSnapshot } from "@/lib/api-client";

const STORAGE_KEY = "karate-state-v5";

export function NetworkSection() {
  const { status, isElectron } = useNetwork();
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDiscovered = useCallback(async () => {
    if (typeof window === "undefined") return;
    const net = window.__KARATE__?.network;
    if (!net) return;
    try {
      const list = await net.listDiscoveredServers();
      setDiscovered(list);
    } catch {}
  }, []);

  useEffect(() => {
    refreshDiscovered();
    const id = setInterval(refreshDiscovered, 3000);
    return () => clearInterval(id);
  }, [refreshDiscovered]);

  async function setMode(mode: "standalone" | "server" | "client") {
    if (typeof window === "undefined") return;
    const net = window.__KARATE__?.network;
    if (!net) return;
    setBusy(true);
    setError(null);
    try {
      const r = await net.setMode(mode);
      if (!r.ok) { setError(r.error ?? "set_mode_failed"); return; }
      if (mode === "server" && r.needsImport) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            await net.importLocalState(parsed);
          } catch (e) {
            setError("local_import_failed: " + (e as Error).message);
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnectAll() {
    const net = window.__KARATE__?.network;
    if (!net) return;
    if (!confirm("Disconnect every client from this server?")) return;
    await net.disconnectAllClients();
  }

  async function connectTo(serverId: string) {
    const net = window.__KARATE__?.network;
    if (!net) return;
    await net.setMode("client");
    await net.connectTo(serverId);
  }

  if (!isElectron) {
    return (
      <section className="super-section">
        <h2>Network</h2>
        <p className="muted">
          Networked multiplayer is available only in the desktop app.
        </p>
      </section>
    );
  }

  const isServer = status.mode === "server";
  const isClient = status.mode === "client";

  return (
    <section className="super-section">
      <h2>Network</h2>
      <p className="muted">
        Run this computer as the server, or connect to another computer on the
        same local network. Server mode makes this computer the source of truth;
        every connected client gets live updates over WebSocket.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={isServer}
            disabled={busy}
            onChange={(e) => setMode(e.target.checked ? "server" : "standalone")}
          />
          <span style={{ fontWeight: 600 }}>This computer is the server</span>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={isClient}
            disabled={busy || isServer}
            onChange={(e) => setMode(e.target.checked ? "client" : "standalone")}
          />
          <span style={{ fontWeight: 600 }}>Connect to a server on the LAN</span>
        </label>
      </div>

      {error && <div style={{ color: "var(--red, #e05252)", marginTop: 10 }}>{error}</div>}

      {isServer && <ServerStatusBox status={status} onDisconnectAll={disconnectAll} />}
      {!isServer && (
        <DiscoveryList
          discovered={discovered}
          status={status}
          onConnectTo={connectTo}
        />
      )}
    </section>
  );
}

function ServerStatusBox({
  status,
  onDisconnectAll,
}: {
  status: NetworkStatusSnapshot;
  onDisconnectAll: () => void;
}) {
  const info = status.serverInfo;
  return (
    <div style={{ marginTop: 14, padding: 12, background: "var(--panel-2, #1d2230)", borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Server status</div>
      <div style={{ fontSize: 13, color: "var(--muted, #8892a4)" }}>
        IP: {info?.serverIp ?? "(no LAN interface)"} · Port: {info?.serverPort ?? 4747}
      </div>
      <div style={{ fontSize: 13, marginTop: 8 }}>
        Connected clients ({status.clients.length}):
      </div>
      {status.clients.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No clients connected.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {status.clients.map((c) => (
            <li key={c.clientId ?? Math.random()}>
              {c.hostname ?? "(unknown)"} · since {new Date(c.connectedAt).toLocaleTimeString()}
              {c.rttMs != null ? ` · rtt ${c.rttMs}ms` : ""}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 10 }}>
        <button onClick={onDisconnectAll} className="danger" style={{ fontSize: 12 }}>
          Disconnect all clients
        </button>
      </div>
    </div>
  );
}

function DiscoveryList({
  discovered,
  status,
  onConnectTo,
}: {
  discovered: DiscoveredServer[];
  status: NetworkStatusSnapshot;
  onConnectTo: (id: string) => void;
}) {
  return (
    <div style={{ marginTop: 14, padding: 12, background: "var(--panel-2, #1d2230)", borderRadius: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Discovered servers
      </div>
      {discovered.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          No servers detected on the local network. The app will keep listening.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border, #2a3142)" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted, #8892a4)" }}>Server</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted, #8892a4)" }}>Port</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted, #8892a4)" }}>Tournament</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {discovered.map((d) => {
              const connectedHere = status.mode === "client" && status.serverInfo?.serverId === d.serverId;
              return (
                <tr key={d.serverId} style={{ borderBottom: "1px solid var(--border, #2a3142)" }}>
                  <td style={{ padding: "6px 8px" }}>{d.serverIp}</td>
                  <td style={{ padding: "6px 8px" }}>{d.serverPort}</td>
                  <td style={{ padding: "6px 8px" }}>{d.tournamentName ?? "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button onClick={() => onConnectTo(d.serverId)} disabled={connectedHere} style={{ fontSize: 12 }}>
                      {connectedHere ? "Connected" : "Connect"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
