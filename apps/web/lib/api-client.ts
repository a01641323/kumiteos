"use client";

import type {
  AuthUser, Role, Feature, KioskSession, LicenseCodeRecord,
} from "@karate/core";

export interface NetworkStatusSnapshot {
  mode: "standalone" | "server" | "client";
  connected: boolean;
  /** Client mode: true once the host's WELCOME has been received (i.e. the
   *  host approved this device). In server/standalone modes always true. */
  welcomed: boolean;
  serverInfo: {
    serverId: string;
    serverIp: string | null;
    serverPort: number;
    hostname: string | null;
  } | null;
  clients: Array<{
    clientId: string | null;
    hostname: string | null;
    role: string;
    connectedAt: number;
    rttMs: number | null;
  }>;
  pending: PendingConnection[];
  stateVersion: number;
}

export interface PendingConnection {
  clientId: string;
  hostname: string;
  ip: string;
  role: string;
  requestedAt: number;
}

export interface ConnectionRejectedEnvelope {
  reason: "denied" | "timeout" | "kicked" | string;
  target: { serverId: string; ip: string; port: number } | null;
}

export type ConnectTarget =
  | string
  | { serverId?: string; ip: string; port?: number };

export interface NetworkStateEnvelope {
  kind: "full";
  state: unknown;
  stateVersion: number;
}

export interface NetworkActionEnvelope {
  actionId: string;
  actionType: string;
  area?: number;
  payload?: Record<string, unknown>;
  clientId?: string;
  ts?: number;
}

export interface NetworkAckEnvelope { actionId: string; newVersion: number; }
export interface NetworkRejectedEnvelope {
  actionId: string;
  reason: string;
  message?: string;
}

export interface DiscoveredServer {
  serverId: string;
  serverIp: string;
  serverPort: number;
  appVersion?: string;
  tournamentName?: string | null;
  startedAt?: number;
}

declare global {
  interface Window {
    __KARATE__?: {
      isElectron?: boolean;
      serverUrl?: string;
      kioskSession?: KioskSession | null;
      license?: {
        getBootstrap: () => Promise<{
          state: unknown;
          token: string | null;
          serverUrl: string;
          machineFingerprint: string;
          kioskSession: KioskSession | null;
        }>;
        getState: () => Promise<{ state: unknown; token: string | null }>;
        activateCode: (code: string) => Promise<{ ok: boolean; error?: string; state?: unknown; token?: string | null }>;
        retryRenewal: () => Promise<{ state: unknown; token: string | null }>;
        reset: () => Promise<{ state: unknown; token: string | null }>;
        onChange: (cb: (envelope: { state: unknown; token: string | null }) => void) => () => void;
      };
      openPublicWindow?: () => void;
      overlay?: {
        onOpen(cb: (payload: { localAdminToken: string; serverUrl: string }) => void): () => void;
        onClose(cb: () => void): () => void;
        onListening?: (cb: () => void) => () => void;
        requestClose(): Promise<{ ok: boolean }>;
      };
      network?: {
        getStatus(): Promise<NetworkStatusSnapshot>;
        getState(): Promise<NetworkStateEnvelope | null>;
        setMode(mode: "standalone" | "server" | "client"): Promise<{ ok: boolean; needsImport?: boolean; error?: string }>;
        importLocalState(state: unknown): Promise<{ ok: boolean; error?: string }>;
        sendAction(action: NetworkActionEnvelope): Promise<{ ok: boolean; error?: string }>;
        listDiscoveredServers(): Promise<DiscoveredServer[]>;
        connectTo(target: ConnectTarget): Promise<{ ok: boolean; error?: string }>;
        disconnectAllClients(): Promise<{ ok: boolean }>;
        disconnectClient(): Promise<{ ok: boolean }>;
        approveConnection(clientId: string): Promise<{ ok: boolean; error?: string }>;
        rejectConnection(clientId: string, reason?: string): Promise<{ ok: boolean; error?: string }>;
        listPending(): Promise<PendingConnection[]>;
        onState(cb: (envelope: NetworkStateEnvelope) => void): () => void;
        onStatus(cb: (status: NetworkStatusSnapshot) => void): () => void;
        onAck(cb: (envelope: NetworkAckEnvelope) => void): () => void;
        onRejected(cb: (envelope: NetworkRejectedEnvelope) => void): () => void;
        onRivalServer(cb: (server: DiscoveredServer) => void): () => void;
        onConnectionRequest(cb: (req: PendingConnection) => void): () => void;
        onConnectionRejected(cb: (envelope: ConnectionRejectedEnvelope) => void): () => void;
      };
    };
  }
}

const DEFAULT_PORT = 4747;

export function getServerUrl(): string {
  if (typeof window === "undefined") return `http://127.0.0.1:${DEFAULT_PORT}`;
  // The karate-bridge sets this to a manual-IP override or window.location.origin.
  if (window.__KARATE__?.serverUrl) return window.__KARATE__.serverUrl;
  const override = window.localStorage.getItem("karate.network.serverUrl")
    ?? window.localStorage.getItem("karate.serverUrl");
  if (override) return override;
  return window.location.origin;
}

export function isElectron(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.__KARATE__?.isElectron;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
  isForm?: boolean;
  headers?: Record<string, string>;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.isForm) body = opts.body as FormData;
    else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const url = getServerUrl().replace(/\/+$/, "") + path;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    body, headers, signal: opts.signal, cache: "no-store",
  });
  if (!res.ok) {
    let code = "request_failed";
    let message = res.statusText;
    try {
      const j = await res.json();
      if (typeof j?.error === "string") code = j.error;
      if (typeof j?.message === "string") message = j.message;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

// ---------- Licensing ----------
export interface ActivationResponse {
  token: string;
  payload: {
    sub: string;
    role: Role;
    features: Feature[];
    plan: string;
    activated_at: number;
    exp: number;
    iat: number;
    jti: string;
  };
  /** Admin-prepared tournament bundle delivered once on activation.
   *  Absent when the code was granted without a preloaded bundle, or
   *  when this is a same-machine re-activation. */
  bundle?: {
    bundleVersion: number;
    label?: string;
    preparedAt?: string;
    categoryDefs: unknown[];
    participants: unknown[];
    settings: {
      subcategorySize: number;
      disciplineMode: "combat" | "kata" | "both";
      areaCount: number;
      pointDifference?: number;
    };
    logoDataUrl: string | null;
  };
}

export async function apiActivate(code: string, machineFingerprint: string): Promise<ActivationResponse> {
  return apiRequest<ActivationResponse>("/api/activate", {
    method: "POST",
    body: { code, machineFingerprint },
  });
}

export async function apiMe(token: string): Promise<{ user: AuthUser; jti: string; exp: number }> {
  return apiRequest("/api/me", { token });
}

// ---------- Kiosk ----------
export async function apiGetKioskSession(signal?: AbortSignal): Promise<KioskSession> {
  return apiRequest<KioskSession>("/api/kiosk-session", { signal });
}

export interface LaunchConfig {
  issuedAt: number;
  expiresAt: number;
  role: string;
  data: Record<string, unknown>;
}

export async function apiPrepareDownload(token: string): Promise<{ tokenId: string }> {
  return apiRequest("/api/prepare-download", { token, method: "POST" });
}

// ---------- Downloads ----------
export interface DownloadInfo { mac: string | null; win: string | null; }

export async function apiGetDownloadInfo(): Promise<DownloadInfo> {
  return apiRequest("/api/download-info");
}

export function downloadUrl(filename: string): string {
  return getServerUrl().replace(/\/+$/, "") + `/api/downloads/${encodeURIComponent(filename)}`;
}

// ---------- License administration (superadmin) ----------
export async function apiAdminGetLicenses(token: string): Promise<{ licenses: LicenseCodeRecord[] }> {
  return apiRequest("/api/admin/licenses", { token });
}

export async function apiAdminCreateLicense(token: string, body: {
  role: Role;
  features?: Feature[];
  label: string;
  ttlDays?: number;
}): Promise<{ code: string; userId: string; label: string; role: Role; features: Feature[]; expiresAt: number }> {
  return apiRequest("/api/admin/licenses", { token, method: "POST", body });
}

export async function apiAdminRevokeLicense(token: string, userId: string): Promise<{ ok: true }> {
  return apiRequest(`/api/admin/licenses/${encodeURIComponent(userId)}/revoke`, { token, method: "POST" });
}

export async function apiAdminTransferLicense(token: string, userId: string): Promise<{ ok: true }> {
  return apiRequest(`/api/admin/licenses/${encodeURIComponent(userId)}/transfer`, { token, method: "POST" });
}

export async function apiAdminExtendLicense(token: string, userId: string, days: number): Promise<{ ok: true; expiresAt: number }> {
  return apiRequest(`/api/admin/licenses/${encodeURIComponent(userId)}/extend`, {
    token, method: "POST", body: { days },
  });
}

// ---------- Tournament data ----------
export interface TournamentDataFile {
  version: number;
  updatedAt: number;
  etag: string;
  data: Record<string, unknown>;
}

export async function apiGetData(token: string): Promise<TournamentDataFile> {
  return apiRequest("/api/data", { token });
}

export async function apiPutData(
  token: string,
  data: Record<string, unknown>
): Promise<TournamentDataFile> {
  return apiRequest("/api/data", { token, method: "PUT", body: data });
}

// ---------- Logo ----------
export interface LogoInfo { filename: string; mime: string; size: number; url: string; }

export async function apiGetLogoInfo(token: string): Promise<{ logo: LogoInfo | null }> {
  return apiRequest("/api/logo-info", { token });
}

export async function apiUploadLogo(token: string, file: File): Promise<{ logo: LogoInfo | null }> {
  const fd = new FormData();
  fd.append("logo", file);
  return apiRequest("/api/upload-logo", { token, method: "POST", body: fd, isForm: true });
}

export async function apiRemoveLogo(token: string): Promise<{ ok: true }> {
  return apiRequest("/api/upload-logo", { token, method: "DELETE" });
}

export function logoSrc(): string {
  return getServerUrl().replace(/\/+$/, "") + "/api/logo";
}

// ---------- App config (superadmin) ----------
export async function apiGetAppConfig(token: string): Promise<{ sessionTtlMinutes: number }> {
  return apiRequest("/api/app-config", { token });
}

export async function apiUpdateAppConfig(token: string, sessionTtlMinutes: number): Promise<{ sessionTtlMinutes: number }> {
  return apiRequest("/api/app-config", { token, method: "PUT", body: { sessionTtlMinutes } });
}
