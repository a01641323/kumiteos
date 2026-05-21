"use client";

// Layered JWT storage.
//   - sessionStorage   → primary copy, cleared on tab close.
//   - localStorage     → AES-256-GCM encrypted copy, key derived from
//                        the browser fingerprint via PBKDF2(100k, SHA-256).
//
// This isn't OS-keychain strength; it's the best available in a pure
// browser context. Documented in README.

import { getBrowserFingerprint } from "./browser-fingerprint";

const SESSION_KEY = "karate.jwt.session";
const LOCAL_BLOB_KEY = "karate.jwt.encrypted.v1";
const SALT_KEY = "karate.jwt.salt.v1";
const PBKDF2_ITERS = 100_000;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function getOrCreateSalt(): Uint8Array {
  const existing = window.localStorage.getItem(SALT_KEY);
  if (existing) return fromBase64(existing);
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  window.localStorage.setItem(SALT_KEY, toBase64(salt));
  return salt;
}

async function deriveKey(): Promise<CryptoKey> {
  const fp = await getBrowserFingerprint();
  const salt = getOrCreateSalt();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(fp),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function setToken(jwt: string): Promise<void> {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(SESSION_KEY, jwt); } catch {}
  try {
    const key = await deriveKey();
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      new TextEncoder().encode(jwt),
    );
    const blob = {
      iv: toBase64(iv),
      ct: toBase64(new Uint8Array(cipher)),
    };
    window.localStorage.setItem(LOCAL_BLOB_KEY, JSON.stringify(blob));
  } catch (err) {
    // Encrypted persistence is best-effort; sessionStorage already has it.
    console.warn("[karate-secure-storage] encrypt failed", err);
  }
}

export async function getToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const inSession = window.sessionStorage.getItem(SESSION_KEY);
    if (inSession) return inSession;
  } catch {}
  try {
    const raw = window.localStorage.getItem(LOCAL_BLOB_KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw) as { iv: string; ct: string };
    const key = await deriveKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(blob.iv) as BufferSource },
      key,
      fromBase64(blob.ct) as BufferSource,
    );
    const jwt = new TextDecoder().decode(plain);
    try { window.sessionStorage.setItem(SESSION_KEY, jwt); } catch {}
    return jwt;
  } catch {
    // Decryption failed — fingerprint likely changed. Drop the blob.
    try { window.localStorage.removeItem(LOCAL_BLOB_KEY); } catch {}
    return null;
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch {}
  try { window.localStorage.removeItem(LOCAL_BLOB_KEY); } catch {}
}
