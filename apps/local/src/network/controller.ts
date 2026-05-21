// Network controller. Owns the state-store + WS server lifecycle and
// emits events the REST/SSE layer can subscribe to.

import { EventEmitter } from "events";
import type { Server as HTTPServer } from "http";
import * as core from "@karate/core";
import { makeStateStore, type StateStore } from "./state-store";
import { makeServer, type WSServer } from "./ws-server";
import { load as loadPersisted, makePersister, type Persister } from "./persistence";

const APP_VERSION = "1.0.0";

export interface NetworkController {
  start(): void;
  stop(): Promise<void>;
  events: EventEmitter;
  getStatus(): any;
  getState(): { state: any; stateVersion: number };
  importLocalState(raw: any): { ok: boolean; error?: string };
  sendAction(envelope: any): { ok: boolean; error?: string };
  listPending(): any[];
  approveConnection(clientId: string): { ok: boolean; error?: string };
  rejectConnection(clientId: string, reason?: string): { ok: boolean; error?: string };
  disconnectAll(): void;
}

export function createNetworkController(opts: {
  httpServer: HTTPServer;
  dataDir: string;
  isHostLicensed?: () => boolean;
}): NetworkController {
  const events = new EventEmitter();
  let lastClients: any[] = [];
  let lastPending: any[] = [];

  const persisted = loadPersisted(opts.dataDir);
  const initial = persisted
    ? (core as any).loadState({
        getItem: (k: string) => (k === "karate-state-v5" ? JSON.stringify(persisted) : null),
      })
    : (core as any).buildInitialState();

  const store: StateStore = makeStateStore(initial);
  const persister: Persister = makePersister(opts.dataDir);

  const server: WSServer = makeServer({
    store,
    persister,
    httpServer: opts.httpServer,
    path: "/ws",
    appVersion: APP_VERSION,
    tournamentName: () => store.getState()?.tournament?.activeCategoryId ?? null,
    isHostLicensed: opts.isHostLicensed,
    onClientsChanged: (list) => { lastClients = list; events.emit("status", getStatus()); },
    onPendingChanged: (list) => { lastPending = list; events.emit("status", getStatus()); },
    onConnectionRequest: (req) => { events.emit("connection-request", req); },
  });

  function getStatus() {
    return {
      mode: "server" as const,
      connected: true,
      welcomed: true,
      serverInfo: {
        serverId: server.getServerId(),
        serverPort: server.getAnnounceInfo().serverPort,
      },
      clients: lastClients,
      pending: lastPending,
      stateVersion: store.getVersion(),
    };
  }

  function getState() {
    return { state: store.getState(), stateVersion: store.getVersion() };
  }

  function importLocalState(raw: any) {
    try {
      const normalized = (core as any).loadState({
        getItem: (k: string) => (k === "karate-state-v5" ? JSON.stringify(raw) : null),
      });
      store.replaceAll(normalized);
      persister.flushNow();
      server.notifyLocalChange();
      events.emit("state", getState());
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "import_failed" };
    }
  }

  function sendAction(envelope: any) {
    if (!envelope || typeof envelope.actionType !== "string") {
      return { ok: false, error: "invalid_envelope" };
    }
    try {
      store.apply(envelope);
      persister.schedule(store.getState(), store.getVersion());
      server.notifyLocalChange();
      events.emit("state", getState());
      events.emit("ack", { actionId: envelope.actionId, newVersion: store.getVersion() });
      return { ok: true };
    } catch (err: any) {
      events.emit("rejected", {
        actionId: envelope.actionId,
        reason: err?.reason ?? "invalid",
        message: err?.message,
      });
      return { ok: false, error: err?.message };
    }
  }

  return {
    start() { server.start(); },
    async stop() { await server.stop(); },
    events,
    getStatus,
    getState,
    importLocalState,
    sendAction,
    listPending: () => server.getPendingList(),
    approveConnection: (id) => server.approveConnection(id),
    rejectConnection: (id, reason) => server.rejectConnection(id, reason),
    disconnectAll: () => server.disconnectAll(),
  };
}
