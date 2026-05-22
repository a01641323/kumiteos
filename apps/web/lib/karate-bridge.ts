"use client";

// Browser-side replacement for the Electron preload bridge.
//
// Installs `window.__KARATE__` with the same shape the renderer code
// already expects (isElectron / serverUrl / kioskSession / openPublicWindow /
// overlay / network). Implementations talk to the local server over
// fetch + WebSocket + Server-Sent Events instead of Electron IPC.
//
// The `license` surface is intentionally omitted: when it's absent,
// auth-context falls through to its existing pure-browser bootstrap
// path (sessionStorage + /api/activate + /api/renew-token).

import type {
  NetworkStatusSnapshot,
  NetworkStateEnvelope,
  NetworkActionEnvelope,
  NetworkAckEnvelope,
  NetworkRejectedEnvelope,
  DiscoveredServer,
  PendingConnection,
  ConnectionRejectedEnvelope,
  ConnectTarget,
} from "./api-client";
import type { KioskSession } from "@karate/core";
import {
  attachStealthChord,
  onOverlayOpen, onOverlayClose, onChordListening,
  requestOverlayClose,
} from "./stealth-chord";

const CLIENT_ID_KEY = "karate.network.clientId";
const SERVER_URL_OVERRIDE_KEY = "karate.network.serverUrl";

type Listener<T> = (payload: T) => void;
function fanout<T>() {
  const set = new Set<Listener<T>>();
  return {
    add(cb: Listener<T>) { set.add(cb); return () => set.delete(cb); },
    emit(payload: T) { for (const cb of set) try { cb(payload); } catch {} },
    size() { return set.size; },
  };
}

function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
  } catch {}
  const id = (crypto.randomUUID?.() ?? `c_${Math.random().toString(36).slice(2)}`);
  try { localStorage.setItem(CLIENT_ID_KEY, id); } catch {}
  return id;
}

function currentServerHttp(): string {
  // 1. Per-session manual override (Connection Screen → manual IP).
  try {
    const override = localStorage.getItem(SERVER_URL_OVERRIDE_KEY);
    if (override) return override;
  } catch {}
  // 2. Build-time override — set in apps/web/.env.local during dev so
  //    `pnpm dev` on :3000 still hits the real Express/WS server on :4747.
  //    Bundled into the static export at build time.
  const envOverride =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_KARATE_SERVER_URL
      : undefined;
  if (envOverride) return envOverride;
  // 3. Same-origin default — what production (binary) mode uses, since
  //    apps/web is served by apps/local on :4747.
  return window.location.origin;
}

function httpToWs(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/ws";
}

function setManualServer(ip: string, port: number) {
  const url = `http://${ip}:${port}`;
  try { localStorage.setItem(SERVER_URL_OVERRIDE_KEY, url); } catch {}
}

function clearManualServer() {
  try { localStorage.removeItem(SERVER_URL_OVERRIDE_KEY); } catch {}
}

interface BridgeState {
  ws: WebSocket | null;
  sse: EventSource | null;
  status: NetworkStatusSnapshot;
  welcomed: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

// Mode is decided LOCALLY based on the browser's hostname, not by what
// the server pushes over SSE. Same kumiteos binary serves both host
// (localhost) and LAN guests, so the server-side status always says
// `mode: "server"` — trusting that for every client made the
// approval modal render on guest machines and prevented guest auth
// status from transitioning out of "anonymous".
function localMode(): "server" | "client" {
  if (typeof window === "undefined") return "client";
  const h = window.location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? "server" : "client";
}

const state: BridgeState = {
  ws: null,
  sse: null,
  status: {
    mode: localMode(),
    connected: false,
    welcomed: false,
    serverInfo: null,
    clients: [],
    pending: [],
    stateVersion: 0,
  },
  welcomed: false,
  reconnectTimer: null,
};

const stateFan = fanout<NetworkStateEnvelope>();
const statusFan = fanout<NetworkStatusSnapshot>();
const ackFan = fanout<NetworkAckEnvelope>();
const rejectedFan = fanout<NetworkRejectedEnvelope>();
const connReqFan = fanout<PendingConnection>();
const connRejFan = fanout<ConnectionRejectedEnvelope>();
const rivalFan = fanout<DiscoveredServer>();
const licenseChangeFan = fanout<{ state: unknown; token: string | null }>();

function pushStatus(patch: Partial<NetworkStatusSnapshot>) {
  // Always override `mode` with the local computation — the server's
  // own `mode: "server"` is irrelevant to the client looking at it.
  state.status = { ...state.status, ...patch, mode: localMode() };
  statusFan.emit(state.status);
}

function connectWs() {
  if (state.ws) { try { state.ws.close(); } catch {} state.ws = null; }
  const url = httpToWs(currentServerHttp());
  let ws: WebSocket;
  try { ws = new WebSocket(url); }
  catch {
    scheduleReconnect();
    return;
  }
  state.ws = ws;
  ws.addEventListener("open", () => {
    pushStatus({ connected: true });
    ws.send(JSON.stringify({
      type: "HELLO",
      clientId: getOrCreateClientId(),
      hostname: window.location.hostname,
      role: "referee",
    }));
  });
  ws.addEventListener("message", (evt) => {
    let msg: any;
    try { msg = JSON.parse(typeof evt.data === "string" ? evt.data : ""); } catch { return; }
    switch (msg?.type) {
      case "WELCOME":
        state.welcomed = true;
        pushStatus({
          welcomed: true,
          serverInfo: { serverId: msg.serverId, serverIp: null, serverPort: 0, hostname: null },
          stateVersion: msg.stateVersion,
        });
        stateFan.emit({ kind: "full", state: msg.state, stateVersion: msg.stateVersion });
        break;
      case "FULL_STATE":
        pushStatus({ stateVersion: msg.stateVersion });
        stateFan.emit({ kind: "full", state: msg.state, stateVersion: msg.stateVersion });
        break;
      case "ACTION_ACK":
        ackFan.emit({ actionId: msg.actionId, newVersion: msg.newVersion });
        break;
      case "ACTION_REJECTED":
        rejectedFan.emit({ actionId: msg.actionId, reason: msg.reason, message: msg.message });
        break;
      case "CLIENT_LIST":
        pushStatus({ clients: msg.clients ?? [] });
        break;
      case "PING":
        try { ws.send(JSON.stringify({ type: "PONG", ts: msg.ts })); } catch {}
        break;
      case "CONNECTION_REJECTED":
        connRejFan.emit({ reason: msg.reason, target: null });
        break;
    }
  });
  ws.addEventListener("close", () => {
    state.welcomed = false;
    pushStatus({ connected: false, welcomed: false });
    scheduleReconnect();
  });
  ws.addEventListener("error", () => {
    try { ws.close(); } catch {}
  });
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectWs();
  }, 2000);
}

function connectSSE() {
  if (state.sse) { try { state.sse.close(); } catch {} }
  const url = currentServerHttp().replace(/\/+$/, "") + "/api/network/events";
  let es: EventSource;
  try { es = new EventSource(url); } catch { return; }
  state.sse = es;
  es.addEventListener("status", (e) => {
    try { pushStatus(JSON.parse((e as MessageEvent).data)); } catch {}
  });
  es.addEventListener("connection-request", (e) => {
    try { connReqFan.emit(JSON.parse((e as MessageEvent).data)); } catch {}
  });
  // state/ack/rejected come over WS too, but the SSE copies are useful
  // if the WS hasn't (re)connected yet.
  es.addEventListener("state", (e) => {
    try {
      const { state: s, stateVersion } = JSON.parse((e as MessageEvent).data);
      stateFan.emit({ kind: "full", state: s, stateVersion });
    } catch {}
  });
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(currentServerHttp().replace(/\/+$/, "") + path, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return (await res.json()) as T;
}

async function fetchKioskSession(): Promise<KioskSession | null> {
  try {
    const res = await fetch(currentServerHttp().replace(/\/+$/, "") + "/api/kiosk-session");
    if (!res.ok) return null;
    return (await res.json()) as KioskSession;
  } catch { return null; }
}

let installed = false;

export function installKarateBridge(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  attachStealthChord();

  const overlay = {
    onOpen(cb: (payload: { localAdminToken: string; serverUrl: string }) => void) {
      return onOverlayOpen(cb);
    },
    onClose(cb: () => void) { return onOverlayClose(cb); },
    onListening(cb: () => void) { return onChordListening(cb); },
    async requestClose() { requestOverlayClose(); return { ok: true }; },
  };

  const network = {
    async getStatus(): Promise<NetworkStatusSnapshot> {
      try { return await http<NetworkStatusSnapshot>("/api/network/status"); }
      catch { return state.status; }
    },
    async getState(): Promise<NetworkStateEnvelope | null> {
      try {
        const { state: s, stateVersion } = await http<{ state: unknown; stateVersion: number }>("/api/network/state");
        return { kind: "full", state: s, stateVersion };
      } catch { return null; }
    },
    async setMode() { return { ok: true } as const; },
    async importLocalState(s: unknown) {
      return http<{ ok: boolean; error?: string }>("/api/network/import-local-state", {
        method: "POST", body: JSON.stringify({ state: s }),
      });
    },
    async sendAction(action: NetworkActionEnvelope) {
      const ws = state.ws;
      if (ws && ws.readyState === WebSocket.OPEN && state.welcomed) {
        try {
          ws.send(JSON.stringify({ type: "ACTION", ...action }));
          return { ok: true } as const;
        } catch { /* fall through to REST */ }
      }
      try {
        return await http<{ ok: boolean; error?: string }>("/api/network/send-action", {
          method: "POST", body: JSON.stringify(action),
        });
      } catch (err: any) {
        return { ok: false, error: err?.message ?? "send_failed" };
      }
    },
    async listDiscoveredServers(): Promise<DiscoveredServer[]> {
      try {
        const j = await http<{ serverIps: string[]; serverPort: number; appVersion: string; tournamentName: string | null }>(
          "/api/discover"
        );
        return j.serverIps.map((ip) => ({
          serverId: `${ip}:${j.serverPort}`,
          serverIp: ip,
          serverPort: j.serverPort,
          appVersion: j.appVersion,
          tournamentName: j.tournamentName,
        }));
      } catch { return []; }
    },
    async connectTo(target: ConnectTarget) {
      if (typeof target === "string") return { ok: false, error: "invalid_target" } as const;
      if (target && typeof target.ip === "string") {
        setManualServer(target.ip, target.port ?? 4747);
        connectWs();
        return { ok: true } as const;
      }
      return { ok: false, error: "invalid_target" } as const;
    },
    async disconnectAllClients() {
      try { await http<{ ok: boolean }>("/api/network/disconnect-all", { method: "POST" }); } catch {}
      return { ok: true } as const;
    },
    async disconnectClient() {
      if (state.ws) { try { state.ws.close(); } catch {} }
      clearManualServer();
      return { ok: true } as const;
    },
    async approveConnection(clientId: string) {
      try {
        return await http<{ ok: boolean; error?: string }>(
          `/api/network/pending/${encodeURIComponent(clientId)}/approve`,
          { method: "POST" },
        );
      } catch (err: any) { return { ok: false, error: err?.message }; }
    },
    async rejectConnection(clientId: string, reason?: string) {
      try {
        return await http<{ ok: boolean; error?: string }>(
          `/api/network/pending/${encodeURIComponent(clientId)}/reject`,
          { method: "POST", body: JSON.stringify({ reason }) },
        );
      } catch (err: any) { return { ok: false, error: err?.message }; }
    },
    async listPending(): Promise<PendingConnection[]> {
      try {
        const j = await http<{ pending: PendingConnection[] }>("/api/network/pending");
        return j.pending;
      } catch { return []; }
    },
    onState(cb: Listener<NetworkStateEnvelope>) { return stateFan.add(cb); },
    onStatus(cb: Listener<NetworkStatusSnapshot>) { return statusFan.add(cb); },
    onAck(cb: Listener<NetworkAckEnvelope>) { return ackFan.add(cb); },
    onRejected(cb: Listener<NetworkRejectedEnvelope>) { return rejectedFan.add(cb); },
    onRivalServer(cb: Listener<DiscoveredServer>) { return rivalFan.add(cb); },
    onConnectionRequest(cb: Listener<PendingConnection>) { return connReqFan.add(cb); },
    onConnectionRejected(cb: Listener<ConnectionRejectedEnvelope>) { return connRejFan.add(cb); },
  };

  const bridge: NonNullable<Window["__KARATE__"]> = {
    isElectron: true,
    serverUrl: currentServerHttp(),
    kioskSession: null,
    openPublicWindow: () => { window.open("/public", "_blank"); },
    overlay,
    network,
  };
  (window as Window & typeof globalThis).__KARATE__ = bridge;

  // Hydrate kioskSession asynchronously without delaying the bridge.
  // (license is intentionally omitted — auth-context falls back to its
  // pure-browser bootstrap via apps/web/lib/secure-storage.ts.)
  void fetchKioskSession().then((ks) => { bridge.kioskSession = ks; });

  // Boot the persistent transports.
  connectWs();
  connectSSE();

  // Re-emit license change events so any subscribed component is reachable
  // even though we don't expose a `license` surface on the bridge.
  void licenseChangeFan; // unused reservation; placeholder for future use
}
