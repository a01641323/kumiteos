"use client";

// Best-effort browser fingerprint. Less stable than a hardware id —
// browser upgrades, monitor changes, or moving between user profiles
// will rotate it. This drives the AES-GCM key for the encrypted
// localStorage copy of the JWT.

const FP_CACHE_KEY = "karate.browserFp.v1";

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getBrowserFingerprint(): Promise<string> {
  if (typeof window === "undefined") return "";
  try {
    const cached = window.localStorage.getItem(FP_CACHE_KEY);
    if (cached) return cached;
  } catch { /* sessionStorage may be blocked */ }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const parts = [
    navigator.userAgent || "",
    String(navigator.hardwareConcurrency ?? ""),
    String((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? ""),
    String(window.screen.width),
    String(window.screen.height),
    tz,
  ];
  const fp = await sha256Hex(parts.join("|"));
  try { window.localStorage.setItem(FP_CACHE_KEY, fp); } catch {}
  return fp;
}
