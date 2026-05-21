// WebSocket server. Mounted on the existing HTTP server via the
// `upgrade` event so it shares the Express port (4747). Owns the
// master timer tick. Inbound actions go through the state-store
// reducer; on success the updated state is broadcast to every
// connected client.

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer, IncomingMessage } from "http";
import * as crypto from "crypto";
import {
  MSG,
  PROTOCOL_VERSION,
  PING_INTERVAL_MS,
  PENDING_TIMEOUT_MS,
  safeParse,
} from "./protocol";
import { ActionRejectedError, type StateStore } from "./state-store";
import type { Persister } from "./persistence";

const MAX_BUFFERED_BYTES = 1024 * 1024;

interface ClientMeta {
  clientId: string | null;
  hostname: string | null;
  ip: string;
  role: "referee" | "superadmin";
  status: "awaiting-hello" | "pending" | "approved";
  connectedAt: number;
  requestedAt: number;
  pendingTimeout: NodeJS.Timeout | null;
  rttMs: number | null;
  pingSentAt: number;
}

export interface WSServerOptions {
  store: StateStore;
  persister: Persister;
  httpServer: HTTPServer;
  path?: string;
  onClientsChanged?: (list: any[]) => void;
  onConnectionRequest?: (req: any) => void;
  onPendingChanged?: (list: any[]) => void;
  isHostLicensed?: () => boolean;
  appVersion: string;
  tournamentName?: () => string | null;
}

export interface WSServer {
  start(): void;
  stop(): Promise<void>;
  disconnectAll(): void;
  getClientList(): any[];
  getPendingList(): any[];
  approveConnection(clientId: string): { ok: boolean; error?: string };
  rejectConnection(clientId: string, reason?: string): { ok: boolean; error?: string };
  notifyLocalChange(): void;
  getAnnounceInfo(): { serverId: string; serverPort: number; appVersion: string; tournamentName: string | null; startedAt: number };
  getServerId(): string;
}

export function makeServer(opts: WSServerOptions): WSServer {
  const { store, persister, httpServer, appVersion } = opts;
  const path = opts.path ?? "/ws";
  let wss: WebSocketServer | null = null;
  let timerInterval: NodeJS.Timeout | null = null;
  let pingInterval: NodeJS.Timeout | null = null;
  let engineInterval: NodeJS.Timeout | null = null;
  let prevTimerRemaining = store.getState().timer.remaining;
  const clients = new Map<WebSocket, ClientMeta>();
  const approvedClientIds = new Set<string>();
  const serverId = crypto.randomUUID();
  const startedAt = Date.now();

  function broadcastState() {
    const snapshot = store.getState();
    const version = store.getVersion();
    const msg = JSON.stringify({
      type: MSG.FULL_STATE,
      stateVersion: version,
      state: snapshot,
    });
    for (const [ws, meta] of clients) {
      if (meta.status !== "approved") continue;
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        try { ws.terminate(); } catch {}
        continue;
      }
      try { ws.send(msg); } catch {}
    }
    persister.schedule(snapshot, version);
  }

  function sendClientList() {
    const list = Array.from(clients.values())
      .filter((c) => c.status === "approved")
      .map((c) => ({
        clientId: c.clientId, hostname: c.hostname, role: c.role,
        connectedAt: c.connectedAt, rttMs: c.rttMs ?? null,
      }));
    opts.onClientsChanged?.(list);
    const msg = JSON.stringify({ type: MSG.CLIENT_LIST, clients: list });
    for (const [ws, meta] of clients) {
      if (meta.status !== "approved") continue;
      if (ws.readyState === ws.OPEN) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  function getPendingList() {
    return Array.from(clients.values())
      .filter((c) => c.status === "pending")
      .map((c) => ({
        clientId: c.clientId, hostname: c.hostname, ip: c.ip,
        role: c.role, requestedAt: c.requestedAt,
      }));
  }

  function notifyPending() {
    try { opts.onPendingChanged?.(getPendingList()); } catch {}
  }

  function findWsByClientId(clientId: string) {
    for (const [ws, meta] of clients) if (meta.clientId === clientId) return { ws, meta };
    return null;
  }

  function sendWelcome(ws: WebSocket, meta: ClientMeta) {
    try { ws.send(JSON.stringify({
      type: MSG.WELCOME,
      serverId,
      protocolVersion: PROTOCOL_VERSION,
      appVersion,
      stateVersion: store.getVersion(),
      state: store.getState(),
      clientId: meta.clientId,
      now: Date.now(),
    })); } catch {}
  }

  function approveConnection(clientId: string) {
    const hit = findWsByClientId(clientId);
    if (!hit) return { ok: false, error: "not_found" };
    const { ws, meta } = hit;
    if (meta.status !== "pending") return { ok: false, error: "not_pending" };
    if (meta.pendingTimeout) { clearTimeout(meta.pendingTimeout); meta.pendingTimeout = null; }
    meta.status = "approved";
    if (meta.clientId) approvedClientIds.add(meta.clientId);
    sendWelcome(ws, meta);
    sendClientList();
    notifyPending();
    return { ok: true };
  }

  function rejectConnection(clientId: string, reason = "denied") {
    const hit = findWsByClientId(clientId);
    if (!hit) return { ok: false, error: "not_found" };
    const { ws, meta } = hit;
    if (meta.pendingTimeout) { clearTimeout(meta.pendingTimeout); meta.pendingTimeout = null; }
    try { ws.send(JSON.stringify({ type: MSG.CONNECTION_REJECTED, reason })); } catch {}
    try { ws.close(); } catch {}
    clients.delete(ws);
    notifyPending();
    return { ok: true };
  }

  function handleAction(ws: WebSocket, _meta: ClientMeta, action: any) {
    if (!action || typeof action.actionType !== "string") {
      try { ws.send(JSON.stringify({
        type: MSG.ACTION_REJECTED, actionId: action?.actionId ?? null,
        reason: "invalid", message: "missing actionType",
      })); } catch {}
      return;
    }
    try {
      const { version } = store.apply(action);
      try { ws.send(JSON.stringify({
        type: MSG.ACTION_ACK, actionId: action.actionId, newVersion: version,
      })); } catch {}
      broadcastState();
    } catch (err: any) {
      const reason = err instanceof ActionRejectedError ? err.reason : "invalid";
      try { ws.send(JSON.stringify({
        type: MSG.ACTION_REJECTED, actionId: action.actionId, reason, message: err.message,
      })); } catch {}
    }
  }

  function startTimerTick() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      const s = store.getState();
      const t = s.timer;
      if (!t.running || t.remaining <= 0) return;
      if (s.match.discipline === "kata") return;
      const next = t.remaining - 1;
      t.remaining = Math.max(0, next);
      if (prevTimerRemaining > 15 && t.remaining === 15) t.warnedAt = Date.now();
      if (t.remaining === 0) { t.running = false; t.finished = true; t.expiredAt = Date.now(); }
      prevTimerRemaining = t.remaining;
      store.replaceAll(s);
      broadcastState();
    }, 1000);
  }

  function startPingLoop() {
    if (pingInterval) return;
    pingInterval = setInterval(() => {
      for (const [ws, meta] of clients) {
        if (ws.readyState !== ws.OPEN) continue;
        if (meta.status !== "approved") continue;
        const now = Date.now();
        meta.pingSentAt = now;
        try { ws.send(JSON.stringify({ type: MSG.PING, ts: now })); } catch {}
      }
    }, PING_INTERVAL_MS);
  }

  function startEngineHeartbeat() {
    if (engineInterval) return;
    engineInterval = setInterval(() => {
      if (typeof store.tickEngineOnly === "function") {
        store.tickEngineOnly();
        broadcastState();
      }
    }, 30000);
  }

  function getAnnounceInfo() {
    return {
      serverId,
      serverPort: (httpServer.address() as any)?.port ?? 0,
      appVersion,
      tournamentName: opts.tournamentName?.() ?? null,
      startedAt,
    };
  }

  function start() {
    wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
      const url = request.url ?? "";
      if (!url.startsWith(path)) {
        socket.destroy();
        return;
      }
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit("connection", ws, request);
      });
    });
    startTimerTick();
    startPingLoop();
    startEngineHeartbeat();

    wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      const rawIp = (request.socket as any)?.remoteAddress || "";
      const ip = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
      const meta: ClientMeta = {
        clientId: null, hostname: null, ip, role: "referee",
        status: "awaiting-hello", connectedAt: Date.now(), requestedAt: 0,
        pendingTimeout: null, rttMs: null, pingSentAt: 0,
      };
      clients.set(ws, meta);
      ws.on("message", (data) => {
        const msg: any = safeParse(data.toString());
        if (!msg) return;
        if (msg.type === MSG.HELLO) {
          if (meta.status === "approved") return;
          meta.clientId = String(msg.clientId || crypto.randomUUID());
          meta.hostname = String(msg.hostname || "(unknown)");
          meta.role = msg.role === "superadmin" ? "superadmin" : "referee";
          meta.requestedAt = Date.now();
          if (typeof opts.isHostLicensed === "function" && !opts.isHostLicensed()) {
            try { ws.send(JSON.stringify({ type: MSG.CONNECTION_REJECTED, reason: "host_unlicensed" })); } catch {}
            try { ws.close(); } catch {}
            clients.delete(ws);
            return;
          }
          const isLoopback = ip === "127.0.0.1" || ip === "::1" || ip === "" || ip.startsWith("127.");
          if (approvedClientIds.has(meta.clientId) || isLoopback) {
            meta.status = "approved";
            if (meta.clientId) approvedClientIds.add(meta.clientId);
            sendWelcome(ws, meta);
            sendClientList();
            return;
          }
          meta.status = "pending";
          meta.pendingTimeout = setTimeout(() => {
            if (meta.status !== "pending") return;
            try { ws.send(JSON.stringify({ type: MSG.CONNECTION_REJECTED, reason: "timeout" })); } catch {}
            try { ws.close(); } catch {}
            clients.delete(ws);
            notifyPending();
          }, PENDING_TIMEOUT_MS);
          opts.onConnectionRequest?.({
            clientId: meta.clientId, hostname: meta.hostname, ip: meta.ip,
            role: meta.role, requestedAt: meta.requestedAt,
          });
          notifyPending();
          return;
        }
        if (meta.status !== "approved") return;
        if (msg.type === MSG.ACTION) { handleAction(ws, meta, msg); return; }
        if (msg.type === MSG.PONG) {
          if (meta.pingSentAt) meta.rttMs = Date.now() - meta.pingSentAt;
          return;
        }
        if (msg.type === MSG.REQUEST_FULL_STATE) {
          try { ws.send(JSON.stringify({
            type: MSG.FULL_STATE, stateVersion: store.getVersion(), state: store.getState(),
          })); } catch {}
          return;
        }
      });
      ws.on("close", () => {
        if (meta.pendingTimeout) { clearTimeout(meta.pendingTimeout); meta.pendingTimeout = null; }
        const wasPending = meta.status === "pending";
        clients.delete(ws);
        if (wasPending) notifyPending(); else sendClientList();
      });
      ws.on("error", () => {
        if (meta.pendingTimeout) { clearTimeout(meta.pendingTimeout); meta.pendingTimeout = null; }
        const wasPending = meta.status === "pending";
        clients.delete(ws);
        if (wasPending) notifyPending(); else sendClientList();
      });
    });
  }

  async function stop() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (engineInterval) { clearInterval(engineInterval); engineInterval = null; }
    for (const [ws] of clients) { try { ws.close(); } catch {} }
    clients.clear();
    if (wss) {
      await new Promise<void>((r) => wss!.close(() => r()));
      wss = null;
    }
    persister.flushNow();
  }

  function disconnectAll() {
    for (const [ws, meta] of clients) {
      if (meta.pendingTimeout) { clearTimeout(meta.pendingTimeout); meta.pendingTimeout = null; }
      try { ws.close(); } catch {}
    }
    approvedClientIds.clear();
    notifyPending();
  }

  function getClientList() {
    return Array.from(clients.values())
      .filter((c) => c.status === "approved")
      .map((c) => ({
        clientId: c.clientId, hostname: c.hostname, role: c.role,
        connectedAt: c.connectedAt, rttMs: c.rttMs ?? null,
      }));
  }

  function notifyLocalChange() { broadcastState(); }

  return {
    start, stop, disconnectAll,
    getClientList, getPendingList,
    approveConnection, rejectConnection,
    notifyLocalChange, getAnnounceInfo,
    getServerId() { return serverId; },
  };
}
