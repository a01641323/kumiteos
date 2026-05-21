import { SignJWT, jwtVerify } from "jose";
import * as crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { Role, Feature } from "@karate/core";
import type { ServerConfig } from "./config";
import type { KeyPair } from "./keys";
import { ALG, KID } from "./keys";
import type { LicenseStore } from "./licenses";

export const ISSUER = "https://api.karate-tournament.app";
export const AUDIENCE = "karate-tournament-app";
export const JWT_TTL_SECONDS = 24 * 60 * 60;

export interface LicensePayload {
  sub: string;            // userId
  iss: string;
  aud: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  machine_fp: string;
  plan: string;
  features: Feature[];
  activated_at: number;
  role: Role;
}

export interface AuthDeps {
  config: ServerConfig;
  keys: KeyPair;
  licenses: LicenseStore;
}

export interface SignTokenOptions {
  userId: string;
  role: Role;
  features: Feature[];
  plan: string;
  machineFingerprint: string;
  activatedAt: number;
  ttlSeconds?: number;
}

export async function signLicenseToken(
  deps: AuthDeps,
  opts: SignTokenOptions,
): Promise<{ token: string; payload: LicensePayload }> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? JWT_TTL_SECONDS;
  const jti = crypto.randomUUID();
  const payload: LicensePayload = {
    sub: opts.userId,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + ttl,
    jti,
    machine_fp: opts.machineFingerprint,
    plan: opts.plan,
    features: opts.features,
    activated_at: opts.activatedAt,
    role: opts.role,
  };
  const token = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG, typ: "JWT", kid: KID })
    .sign(deps.keys.privateKey);
  return { token, payload };
}

export async function verifyLicenseToken(
  deps: AuthDeps,
  token: string,
): Promise<LicensePayload | null> {
  try {
    const { payload } = await jwtVerify(token, deps.keys.publicKey, {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload as unknown as LicensePayload;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  auth?: LicensePayload;
}

export function requireAuth(deps: AuthDeps) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing_token" });
      return;
    }
    const payload = await verifyLicenseToken(deps, header.slice(7).trim());
    if (!payload) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    if (deps.licenses.isRevoked(payload.jti)) {
      res.status(401).json({ error: "ACCESS_REVOKED" });
      return;
    }
    const record = deps.licenses.findByUserId(payload.sub);
    if (record && record.expiresAt < Date.now()) {
      res.status(401).json({ error: "ACCESS_REVOKED" });
      return;
    }
    req.auth = payload;
    next();
  };
}

export function requireRole(role: Role | Role[]) {
  const roles = Array.isArray(role) ? role : [role];
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
