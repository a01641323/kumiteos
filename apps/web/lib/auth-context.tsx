"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import type {
  AuthUser, Role, LicenseState, LicensePublic, LicenseDegradedReason,
} from "@karate/core";
import type { ConnectTarget } from "./api-client";
import { apiActivate, apiMe, apiVerifyJtiOnCloud, ApiError } from "./api-client";
import { getBrowserFingerprint } from "./browser-fingerprint";
import { setToken as secureSetToken, getToken as secureGetToken, clearToken as secureClearToken } from "./secure-storage";
import * as Actions from "./store-actions";

/**
 * License-aware auth context. Replaces the old username/password AuthProvider.
 *
 * In Electron: state is owned by the main process. The preload exposes
 * `window.__KARATE__.license` for read/activate/reset. The JWT is kept in
 * main process and copied into renderer memory only for the lifetime of an
 * API call.
 *
 * In browser-only (web dev): the renderer talks to /api/activate directly,
 * holds the JWT in memory, and runs its own renewal loop. The machine
 * fingerprint is a per-browser random salt (acceptable for dev).
 */

const TOKEN_KEY = "karate.session.jwt";       // sessionStorage — survives reloads only
const STATE_KEY = "karate.session.state";     // sessionStorage — for browser-only mode
const FP_KEY = "karate.browser.fp";

export interface GuestSessionInfo {
  serverId: string | null;
  serverIp: string | null;
  serverPort: number | null;
  clientId: string | null;
}

export type AuthStatus =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authed"; session: { user: AuthUser; expiresAt: number; issuedAt: number; token: string }; license: LicensePublic; isGrace: boolean; graceRemainingMs: number }
  | { kind: "locked"; reason: LicenseDegradedReason }
  | { kind: "guest"; user: AuthUser; session: GuestSessionInfo };

interface AuthApi {
  status: AuthStatus;
  user: AuthUser | null;
  token: string | null;
  isKiosk: boolean;
  machineFingerprint: string | null;
  graceRemainingMs: number;
  licenseState: LicenseState;
  login(code: string): Promise<AuthUser>;
  logout(): void;
  redeemCode(code: string): Promise<void>;
  retryRenewal(): Promise<void>;
  hasRole(role: Role | Role[]): boolean;
  /** Join a host on the LAN as a guest. Resolves once the host approves
   *  (WELCOME received) and rejects on denial / timeout / connection failure. */
  joinAsGuest(target: ConnectTarget): Promise<void>;
  /** Leave a host session and return to standalone/anonymous. */
  leaveGuest(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

function randHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined") crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface JwtClaims {
  sub: string;
  role: AuthUser["role"];
  features: AuthUser["features"];
  plan: string;
  exp: number;
  iat: number;
  jti: string;
  activated_at?: number;
}

// Best-effort JWT payload decode. We don't verify the signature here
// because the local server (and ultimately the cloud) already verifies
// on every authenticated request; we only need the claim values to
// hydrate the UI from a cached token at boot.
function decodeJwtClaims(jwt: string): JwtClaims | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

// Cached fingerprint snapshot. Synchronous helpers fall back to this
// after the async fingerprint resolves once on bootstrap.
let cachedFp: string | null = null;

function getBrowserMachineFp(): string {
  if (typeof window === "undefined") return "";
  if (cachedFp) return cachedFp;
  // Legacy random fingerprint as a fallback for callers before the
  // SHA-256-derived fingerprint has hydrated. Auth bootstrap awaits the
  // real one and overwrites cachedFp.
  let fp = window.localStorage.getItem(FP_KEY);
  if (!fp) {
    fp = randHex(32);
    window.localStorage.setItem(FP_KEY, fp);
  }
  cachedFp = fp;
  return fp;
}

function readSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

function persistSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
  // Also persist an AES-GCM encrypted copy in localStorage so the
  // session survives a tab close within the 24h JWT window.
  void secureSetToken(token);
}

function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(STATE_KEY);
  secureClearToken();
}

function buildAuthedStatus(license: LicensePublic, token: string, isGrace: boolean, graceRemainingMs: number): AuthStatus {
  return {
    kind: "authed",
    session: {
      token,
      issuedAt: license.activatedAt,
      expiresAt: license.expiresAt,
      user: { role: license.role, features: license.features },
    },
    license,
    isGrace,
    graceRemainingMs,
  };
}

function statusFromState(state: LicenseState, token: string | null): AuthStatus {
  if (state.kind === "unlicensed") return { kind: "anonymous" };
  if (state.kind === "degraded") return { kind: "locked", reason: state.reason };
  if (state.kind === "active") {
    if (!token) return { kind: "loading" };
    return buildAuthedStatus(state.license, token, false, 0);
  }
  // grace
  if (!token) return { kind: "loading" };
  return buildAuthedStatus(state.license, token, true, state.graceRemainingMs);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [licenseState, setLicenseState] = useState<LicenseState>({ kind: "unlicensed" });
  const [token, setToken] = useState<string | null>(null);
  const [machineFp, setMachineFp] = useState<string | null>(null);
  const [guestSession, setGuestSession] = useState<GuestSessionInfo | null>(null);
  const isKioskRef = useRef(false);
  const [status, setStatus] = useState<AuthStatus>({ kind: "loading" });
  // Stays false until the async bootstrap below finishes. Until then the
  // status effect must NOT fall through to the unlicensed→anonymous
  // default, or the LoginScreen ("access code window") flashes for a
  // frame on every refresh before the real license hydrates.
  const [booted, setBooted] = useState(false);

  // ------- Bootstrap -------
  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        await bootstrapInner();
      } finally {
        if (mounted) setBooted(true);
      }
    }
    async function bootstrapInner() {
      // Kiosk session — same path as before.
      const kiosk = (typeof window !== "undefined" ? window.__KARATE__?.kioskSession : null);
      if (kiosk) {
        if (kiosk.expiresAt > Date.now()) {
          isKioskRef.current = true;
          setToken(kiosk.token);
          const fakeState: LicenseState = {
            kind: "active",
            license: {
              role: kiosk.user.role,
              features: kiosk.user.features ?? [],
              plan: kiosk.user.role,
              expiresAt: kiosk.expiresAt,
              activatedAt: kiosk.issuedAt,
              jti: "kiosk",
            },
          };
          setLicenseState(fakeState);
          return;
        }
      }

      // Electron flow — main process owns the state.
      const license = (typeof window !== "undefined" ? window.__KARATE__?.license : null);
      if (license) {
        const boot = await license.getBootstrap();
        if (!mounted) return;
        const state = (boot.state ?? { kind: "unlicensed" }) as LicenseState;
        setMachineFp(boot.machineFingerprint);
        setLicenseState(state);
        setToken(boot.token ?? null);
        license.onChange((envelope) => {
          const newState = (envelope?.state ?? { kind: "unlicensed" }) as LicenseState;
          setLicenseState(newState);
          // If the main process sends token:null while the license is still
          // active/grace (e.g. a transient storage read failure), keep the
          // current token so the session isn't cleared spuriously.
          setToken((prev) => {
            const next = envelope?.token ?? null;
            if (next !== null) return next;
            if (newState.kind === "active" || newState.kind === "grace") return prev;
            return null;
          });
        });
        return;
      }

      // Browser-only fallback. Hydrate fingerprint + encrypted JWT first.
      try {
        const fp = await getBrowserFingerprint();
        if (fp) { cachedFp = fp; }
      } catch {}
      setMachineFp(getBrowserMachineFp());
      // Hydrate sessionStorage from the AES-GCM encrypted localStorage
      // copy if we lost sessionStorage on tab close.
      await secureGetToken();
      const cached = readSessionToken();
      if (cached) {
        // Per-tournament one-shot model: no renewal endpoint. Trust the
        // cached JWT until its exp arrives; the lock-screen takes over
        // once it's stale.
        const claims = decodeJwtClaims(cached);
        const stillValid = claims && claims.exp * 1000 > Date.now();
        if (stillValid) {
          if (!mounted) return;
          setToken(cached);
          setLicenseState({
            kind: "active",
            license: {
              role: claims!.role,
              features: claims!.features,
              plan: claims!.plan,
              expiresAt: claims!.exp * 1000,
              activatedAt: (claims!.activated_at ?? claims!.iat) * 1000,
              jti: claims!.jti,
            },
          });
        } else {
          clearSessionToken();
          if (!mounted) return;
          setLicenseState({ kind: "unlicensed" });
        }
      } else {
        if (!mounted) return;
        setLicenseState({ kind: "unlicensed" });
      }
    }
    bootstrap();
    return () => { mounted = false; };
  }, []);

  // Subscribe to network status — a welcomed client connection means this
  // device has been approved by a host and should run in "guest" mode,
  // bypassing the per-device license check.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const net = window.__KARATE__?.network;
    if (!net) return;
    let cancelled = false;
    net.getStatus().then((s) => {
      if (cancelled) return;
      console.log("[karate-debug-connection] (renderer) initial net.getStatus →", s.mode, "welcomed=", s.welcomed, "serverInfo?", !!s.serverInfo);
      if (s.mode === "client" && s.welcomed && s.serverInfo) {
        setGuestSession({
          serverId: s.serverInfo.serverId,
          serverIp: s.serverInfo.serverIp,
          serverPort: s.serverInfo.serverPort,
          clientId: null,
        });
      }
    }).catch(() => {});
    const offStatus = net.onStatus((s) => {
      console.log("[karate-debug-connection] (renderer) net.onStatus →", s.mode, "welcomed=", s.welcomed, "serverInfo?", !!s.serverInfo);
      if (s.mode === "client" && s.welcomed && s.serverInfo) {
        setGuestSession((prev) => ({
          serverId: s.serverInfo!.serverId,
          serverIp: s.serverInfo!.serverIp,
          serverPort: s.serverInfo!.serverPort,
          clientId: prev?.clientId ?? null,
        }));
      } else if (s.mode !== "client") {
        setGuestSession(null);
      } else if (!s.welcomed) {
        // Still in client mode but lost the welcomed state (host gone).
        // Keep guestSession until disconnect surfaces via the rejection
        // channel or the user explicitly leaves — otherwise a transient
        // reconnect cycle would flap the auth status.
      }
    });
    return () => { cancelled = true; offStatus(); };
  }, []);

  // Recompute the renderer-facing status whenever inputs change. Guest
  // takes precedence over the license-derived status.
  useEffect(() => {
    if (guestSession) {
      setStatus({
        kind: "guest",
        user: { role: "referee", features: ["scoring", "bracket_view", "public_display"] },
        session: guestSession,
      });
      return;
    }
    // Hold on "loading" until bootstrap has hydrated the real license —
    // prevents the LoginScreen from flashing on refresh.
    if (!booted) {
      setStatus({ kind: "loading" });
      return;
    }
    setStatus(statusFromState(licenseState, token));
  }, [licenseState, token, guestSession, booted]);

  // Heartbeat — local + cloud.
  //
  //  - Every 30 s: hit the local /api/me. Detects LAN-side revokes
  //    (operator restarted the server with a rotated jti, etc.) and
  //    catches JWT exp the instant it ticks past now.
  //  - Every 5 min: hit cloud's /api/verify-jti so an admin revoke
  //    from /admin/codes propagates to the running customer binary
  //    even though there's no other cloud chatter post-activation.
  //
  // Cloud probe is best-effort — if we're offline (or the customer is
  // running on a tournament LAN with no internet), the fetch throws,
  // we swallow it, and the next tick tries again. Offline customers
  // therefore keep working until the JWT exp arrives, which is the
  // explicit "rental-style timeout works offline" requirement.
  //
  // Guests (mode === "client") never call cloud — the host owns the
  // authoritative session.
  useEffect(() => {
    if (!token || isKioskRef.current) return;
    const jti = licenseState.kind === "active" || licenseState.kind === "grace"
      ? licenseState.license.jti
      : null;
    let lastCloudCheck = 0;
    const CLOUD_INTERVAL_MS = 5 * 60 * 1000;
    const check = async () => {
      // Host anti-tamper lock: the local server enforces the offline window
      // (clock rollback / freeze) and reports it here. Checked BEFORE apiMe so
      // the reason-bearing lock screen wins over apiMe's generic 401 path.
      if (!guestSession && (licenseState.kind === "active" || licenseState.kind === "grace")) {
        try {
          const r = await fetch("/api/session/status", { cache: "no-store" });
          if (r.ok) {
            const { locked } = (await r.json()) as { locked: "CLOCK_TAMPER" | "EXPIRED" | null };
            if (locked) {
              const lastRole = licenseState.license.role;
              const license = typeof window !== "undefined" ? window.__KARATE__?.license : null;
              if (license) await license.reset().catch(() => null);
              clearSessionToken();
              setToken(null);
              setLicenseState({ kind: "degraded", reason: locked, lastRole });
              return;
            }
          }
        } catch {
          // No local server / network hiccup → ignore; JWT exp is the ceiling.
        }
      }

      try {
        await apiMe(token);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          const license = (typeof window !== "undefined" ? window.__KARATE__?.license : null);
          if (license) {
            const envelope = await license.retryRenewal().catch(() => null);
            setLicenseState((envelope?.state ?? { kind: "unlicensed" }) as LicenseState);
            setToken(envelope?.token ?? null);
          } else {
            clearSessionToken();
            setToken(null);
            setLicenseState({ kind: "unlicensed" });
          }
          return;
        }
      }

      // Cloud revoke probe.
      const onLine = typeof navigator !== "undefined" ? navigator.onLine : true;
      const now = Date.now();
      if (
        onLine && !guestSession && jti && jti !== "kiosk" &&
        now - lastCloudCheck >= CLOUD_INTERVAL_MS
      ) {
        lastCloudCheck = now;
        try {
          const { revoked } = await apiVerifyJtiOnCloud(jti);
          if (revoked) {
            const license = (typeof window !== "undefined" ? window.__KARATE__?.license : null);
            const lastRole = licenseState.kind === "active" || licenseState.kind === "grace"
              ? licenseState.license.role
              : null;
            if (license) {
              await license.reset().catch(() => null);
            }
            clearSessionToken();
            setToken(null);
            // Land on the LockScreen ("Tu código expiró") rather than
            // LoginScreen so the customer sees a clear expiry message
            // instead of a fresh activation form.
            setLicenseState({ kind: "degraded", reason: "REVOKED", lastRole });
          }
        } catch {
          // Network failure → swallow. JWT exp is the hard ceiling.
        }
      }
    };
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [token, licenseState, guestSession]);

  // ------- Actions -------
  const login = useCallback(async (code: string): Promise<AuthUser> => {
    const license = (typeof window !== "undefined" ? window.__KARATE__?.license : null);
    if (license) {
      const r = await license.activateCode(code);
      if (!r.ok) throw new Error(r.error || "activation_failed");
      const state = (r.state ?? { kind: "unlicensed" }) as LicenseState;
      setLicenseState(state);
      setToken(r.token ?? null);
      if (state.kind === "active") {
        return { role: state.license.role, features: state.license.features };
      }
      throw new Error("activation_failed");
    }
    // Browser fallback.
    const fp = machineFp ?? getBrowserMachineFp();
    const r = await apiActivate(code, fp);
    persistSessionToken(r.token);
    setToken(r.token);
    const next: LicenseState = {
      kind: "active",
      license: {
        role: r.payload.role,
        features: r.payload.features,
        plan: r.payload.plan,
        expiresAt: r.payload.exp * 1000,
        activatedAt: r.payload.activated_at * 1000,
        jti: r.payload.jti,
      },
    };
    setLicenseState(next);

    // Apply any admin-prepared tournament bundle the cloud handed us.
    // Best-effort — failure here doesn't block activation; the operator
    // can always fall back to configuring manually.
    if (r.bundle) {
      try {
        const net = (typeof window !== "undefined" ? window.__KARATE__?.network : null);
        if (net) {
          await net.sendAction(Actions.replaceTournamentBundle(r.bundle));
        }
      } catch (err) {
        console.warn("[karate-bundle] failed to apply preloaded bundle:", err);
      }
    }

    return { role: r.payload.role, features: r.payload.features };
  }, [machineFp]);

  const retryRenewal = useCallback(async () => {
    const license = (typeof window !== "undefined" ? window.__KARATE__?.license : null);
    if (license) {
      const envelope = await license.retryRenewal();
      setLicenseState((envelope?.state ?? { kind: "unlicensed" }) as LicenseState);
      setToken(envelope?.token ?? null);
      return;
    }
    // No renewal endpoint in the per-tournament model. "Retry" just
    // re-evaluates the cached JWT; if it's still valid, restore; if
    // expired, force re-activation.
    const cached = readSessionToken();
    if (!cached) {
      setLicenseState({ kind: "unlicensed" });
      return;
    }
    const claims = decodeJwtClaims(cached);
    if (claims && claims.exp * 1000 > Date.now()) {
      setToken(cached);
      setLicenseState({
        kind: "active",
        license: {
          role: claims.role,
          features: claims.features,
          plan: claims.plan,
          expiresAt: claims.exp * 1000,
          activatedAt: (claims.activated_at ?? claims.iat) * 1000,
          jti: claims.jti,
        },
      });
    } else {
      clearSessionToken();
      setLicenseState({ kind: "unlicensed" });
    }
  }, []);

  const logout = useCallback(() => {
    clearSessionToken();
    setToken(null);
    const w = typeof window !== "undefined" ? window.__KARATE__ : null;
    // Guest sessions don't have their own license — just drop the network
    // connection and return to the LoginScreen.
    const net = w?.network;
    if (net) {
      setGuestSession(null);
      void net.disconnectClient().catch(() => {});
      void net.setMode("standalone").catch(() => {});
    }
    const license = w?.license;
    if (license) {
      void license.reset();
    }
    setLicenseState({ kind: "unlicensed" });
  }, []);

  const redeemCode = useCallback(async (code: string): Promise<void> => {
    await login(code);
  }, [login]);

  const joinAsGuest = useCallback(async (target: ConnectTarget): Promise<void> => {
    const net = typeof window !== "undefined" ? window.__KARATE__?.network : null;
    if (!net) throw new Error("network_unavailable");
    const setRes = await net.setMode("client");
    if (!setRes.ok) throw new Error(setRes.error || "set_mode_failed");
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup: Array<() => void> = [];
      const finishOk = () => {
        if (settled) return;
        settled = true;
        cleanup.forEach((fn) => fn());
        resolve();
      };
      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup.forEach((fn) => fn());
        reject(err);
      };
      cleanup.push(net.onStatus((s) => {
        if (s.mode === "client" && s.welcomed) finishOk();
      }));
      cleanup.push(net.onConnectionRejected((env) => {
        finishErr(new Error(env.reason || "rejected"));
      }));
      // Belt-and-braces timeout — server enforces 60s, give the renderer
      // 75s to receive the message before bailing out.
      const t = setTimeout(() => finishErr(new Error("timeout")), 75_000);
      cleanup.push(() => clearTimeout(t));
      net.connectTo(target).then((r) => {
        if (!r.ok) finishErr(new Error(r.error || "connect_failed"));
      }).catch((err) => finishErr(err instanceof Error ? err : new Error("connect_failed")));
    });
  }, []);

  const leaveGuest = useCallback(async (): Promise<void> => {
    const net = typeof window !== "undefined" ? window.__KARATE__?.network : null;
    setGuestSession(null);
    if (!net) return;
    try { await net.disconnectClient(); } catch {}
    try { await net.setMode("standalone"); } catch {}
  }, []);

  const api: AuthApi = useMemo(() => {
    const currentUser: AuthUser | null =
      status.kind === "authed" ? status.session.user
      : status.kind === "guest" ? status.user
      : null;
    return {
      status,
      user: currentUser,
      token: status.kind === "authed" ? status.session.token : null,
      isKiosk: isKioskRef.current,
      machineFingerprint: machineFp,
      licenseState,
      graceRemainingMs:
        licenseState.kind === "grace" ? licenseState.graceRemainingMs : 0,
      login, logout, redeemCode, retryRenewal,
      joinAsGuest, leaveGuest,
      hasRole(role) {
        if (!currentUser) return false;
        const roles = Array.isArray(role) ? role : [role];
        return roles.includes(currentUser.role);
      },
    };
  }, [status, licenseState, machineFp, login, logout, redeemCode, retryRenewal, joinAsGuest, leaveGuest]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
