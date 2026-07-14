import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "./storage";

// All persisted session state (identity + clock high-water mark + monotonic
// budget) lives in ONE file, sealed with an HMAC keyed by a per-install random
// key. Hand-editing any byte invalidates the whole thing. Ported from the
// interface template's cli/lib/sealed-store.mjs. See docs SECURITY notes for
// what this does NOT prevent (a local attacker can read the key and re-seal).

export const KEY_FILE = "install-key";
export const STATE_FILE = "session.json";

export interface SealedSessionState {
  /** Stable license identity (JWT `sub`); survives across restarts. */
  sub: string;
  /** ms — start of the granted window (JWT iat). */
  issuedAt: number;
  /** ms — end of the granted window (JWT exp + offline grace). */
  expiresAt: number;
  /** ms — newest wall-clock time ever observed. */
  highWater: number;
  /** ms — accumulated monotonic runtime. */
  budgetUsedMs: number;
}

export interface Sealed<T> {
  payload: T;
  mac: string;
}

function keysDir(dataDir: string): string {
  return path.join(dataDir, "keys");
}

export function seal<T>(payload: T, keyHex: string): Sealed<T> {
  const body = JSON.stringify(payload);
  const mac = createHmac("sha256", Buffer.from(keyHex, "hex")).update(body).digest("hex");
  return { payload, mac };
}

export function unseal<T>(container: Sealed<T> | null | undefined, keyHex: string): T | null {
  if (!container || typeof container !== "object") return null;
  if (container.payload === undefined || typeof container.mac !== "string") return null;
  const body = JSON.stringify(container.payload);
  const expected = createHmac("sha256", Buffer.from(keyHex, "hex")).update(body).digest("hex");
  const actual = Buffer.from(container.mac);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  return container.payload;
}

// Created here on first run; the key protects against hand-editing, not
// against reading (mode 600).
export function loadInstallKey(dataDir: string): string {
  const dir = keysDir(dataDir);
  const file = path.join(dir, KEY_FILE);
  try {
    const key = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(key)) return key;
  } catch {
    /* missing or unreadable → regenerate */
  }
  const key = randomBytes(32).toString("hex");
  ensureDir(dir);
  fs.writeFileSync(file, key + "\n", { mode: 0o600 });
  return key;
}

export function readState(dataDir: string, keyHex: string): SealedSessionState | null {
  const file = path.join(keysDir(dataDir), STATE_FILE);
  let container: Sealed<SealedSessionState>;
  try {
    container = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const payload = unseal(container, keyHex);
  if (!payload) {
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } // integrity failure → delete on sight
    return null;
  }
  return payload;
}

export function writeState(dataDir: string, keyHex: string, payload: SealedSessionState): void {
  const dir = keysDir(dataDir);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(seal(payload, keyHex)));
}

export function deleteState(dataDir: string): void {
  try { fs.rmSync(path.join(keysDir(dataDir), STATE_FILE), { force: true }); } catch { /* ignore */ }
}
