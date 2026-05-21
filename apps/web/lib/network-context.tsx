"use client";

// NetworkProvider — bridges the renderer to the main-process network
// controller via IPC. Owns:
//   - networkStatus: current mode + connection state + peer list
//   - networkState : last full state envelope received from the controller
//
// In CLIENT / SERVER modes the StoreProvider consults this context to
// decide whether to mutate locally or route through `network.sendAction`.

import {
  createContext, useContext, useEffect, useMemo, useState,
} from "react";
import type { AppState } from "@karate/core";
import type {
  NetworkStatusSnapshot,
  NetworkStateEnvelope,
} from "./api-client";

export type NetworkMode = "standalone" | "server" | "client";

export interface NetworkApi {
  status: NetworkStatusSnapshot;
  networkState: AppState | null;
  networkStateVersion: number;
  isElectron: boolean;
}

const DEFAULT_STATUS: NetworkStatusSnapshot = {
  mode: "standalone",
  connected: false,
  welcomed: false,
  serverInfo: null,
  clients: [],
  pending: [],
  stateVersion: 0,
};

const NetworkContext = createContext<NetworkApi | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<NetworkStatusSnapshot>(DEFAULT_STATUS);
  const [networkState, setNetworkState] = useState<AppState | null>(null);
  const [networkStateVersion, setNetworkStateVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const net = window.__KARATE__?.network;
    if (!net) return;
    let cancelled = false;
    net.getStatus().then((s) => { if (!cancelled) setStatus(s); }).catch(() => {});
    // Re-hydrate the last-known state from the main process. The Electron
    // main process holds the canonical state across renderer reloads — the
    // renderer itself only sees future onState events, so without this
    // fetch a cmd+R during a guest session would leave networkState=null
    // and the UI would render an empty tournament.
    net.getState().then((env) => {
      if (cancelled || !env) return;
      setNetworkState(env.state as AppState);
      setNetworkStateVersion(env.stateVersion);
    }).catch(() => {});
    const offStatus = net.onStatus((s) => setStatus(s));
    const offState = net.onState((env: NetworkStateEnvelope) => {
      setNetworkState(env.state as AppState);
      setNetworkStateVersion(env.stateVersion);
    });
    return () => { cancelled = true; offStatus(); offState(); };
  }, []);

  const api: NetworkApi = useMemo(() => ({
    status,
    networkState,
    networkStateVersion,
    isElectron:
      typeof window !== "undefined" && !!window.__KARATE__?.isElectron,
  }), [status, networkState, networkStateVersion]);

  return <NetworkContext.Provider value={api}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkApi {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    return {
      status: DEFAULT_STATUS,
      networkState: null,
      networkStateVersion: 0,
      isElectron: false,
    };
  }
  return ctx;
}

export function useNetworkMode(): NetworkMode {
  return useNetwork().status.mode;
}

export function useNetworkStatus(): NetworkStatusSnapshot {
  return useNetwork().status;
}

/** Whether the current renderer can dispatch state-mutating actions. */
export function isActionable(status: NetworkStatusSnapshot): boolean {
  if (status.mode === "standalone") return true;
  if (status.mode === "server") return true;
  return status.connected;
}
