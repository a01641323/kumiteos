"use client";

// Local-admin API client. Calls go to the bundled loopback server with an
// X-Karate-Local-Admin header carrying the per-launch elevation token. The
// token is delivered to the overlay via `karate:overlay-open` and held in
// a useRef inside OverlayProvider — never persisted, never on `window`.

import type {
  Feature, Role, LicenseCodeRecord,
} from "@karate/core";
import { getServerUrl, ApiError } from "./api-client";

const HEADER = "X-Karate-Local-Admin";

interface RequestOptions {
  method?: string;
  body?: unknown;
  isForm?: boolean;
  token: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.isForm) body = opts.body as FormData;
    else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }
  headers[HEADER] = opts.token;
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
    } catch {}
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

export async function adminGetLicenses(token: string): Promise<{ licenses: LicenseCodeRecord[] }> {
  return request("/api/admin/licenses", { token });
}

export async function adminCreateLicense(token: string, body: {
  features?: Feature[];
  label: string;
  ttlMinutes?: number;
}): Promise<{ code: string; userId: string; label: string; role: Role; features: Feature[]; expiresAt: number }> {
  return request("/api/admin/licenses", { token, method: "POST", body });
}

export async function adminRevokeLicense(token: string, userId: string): Promise<{ ok: true }> {
  return request(`/api/admin/licenses/${encodeURIComponent(userId)}/revoke`, { token, method: "POST" });
}

export async function adminTransferLicense(token: string, userId: string): Promise<{ ok: true }> {
  return request(`/api/admin/licenses/${encodeURIComponent(userId)}/transfer`, { token, method: "POST" });
}

export async function adminExtendLicense(token: string, userId: string, minutes: number): Promise<{ ok: true; expiresAt: number }> {
  return request(`/api/admin/licenses/${encodeURIComponent(userId)}/extend`, {
    token, method: "POST", body: { minutes },
  });
}

export async function adminPutData(token: string, data: Record<string, unknown>): Promise<unknown> {
  return request("/api/data", { token, method: "PUT", body: data });
}

export async function adminUploadLogo(token: string, file: File): Promise<unknown> {
  const fd = new FormData();
  fd.append("logo", file);
  return request("/api/upload-logo", { token, method: "POST", body: fd, isForm: true });
}

export async function adminRemoveLogo(token: string): Promise<{ ok: true }> {
  return request("/api/upload-logo", { token, method: "DELETE" });
}

export async function adminGetAppConfig(token: string): Promise<{ sessionTtlMinutes: number }> {
  return request("/api/app-config", { token });
}

export async function adminUpdateAppConfig(token: string, sessionTtlMinutes: number): Promise<{ sessionTtlMinutes: number }> {
  return request("/api/app-config", { token, method: "PUT", body: { sessionTtlMinutes } });
}
