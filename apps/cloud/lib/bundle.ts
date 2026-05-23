// Tournament bundle storage. A bundle is the cloned tournament config
// (participants, categories, settings, logo) the admin prepares ahead
// of time and ships alongside the 6-digit access code. The customer's
// binary applies it on activation so they don't have to configure
// anything themselves.
//
// Stored inline in Vercel KV; the bundle is small enough (a few
// hundred KB at worst including a base64 logo) to skip object storage.

import { kv, keys } from "./kv";

export const BUNDLE_VERSION = 1;
/** Hard ceiling on a serialized bundle so KV stays healthy. */
const MAX_BUNDLE_BYTES = 600 * 1024;

export interface BundleSettings {
  subcategorySize: number;
  disciplineMode: "combat" | "kata" | "both";
  areaCount: number;
  pointDifference?: number;
}

export interface TournamentBundle {
  bundleVersion: number;
  label?: string;
  preparedAt?: string;
  categoryDefs: unknown[];
  /** Participant rows. `id` is stripped (re-generated on apply). */
  participants: unknown[];
  settings: BundleSettings;
  logoDataUrl: string | null;
}

export interface BundleMeta {
  label: string | null;
  preparedAt: string | null;
  participantCount: number;
  categoryCount: number;
  hasLogo: boolean;
  sizeBytes: number;
  storedAt: number;
}

export type ValidationResult =
  | { ok: true; bundle: TournamentBundle; sizeBytes: number }
  | { ok: false; error: string };

/**
 * Shape-check a parsed JSON value. Does not verify semantic
 * correctness (bracket sanity, name uniqueness, etc) — the local
 * applier will surface any logic problems when it rebuilds.
 */
export function validateBundle(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "bundle must be a JSON object" };
  }
  const b = raw as Record<string, unknown>;

  if (b.bundleVersion !== BUNDLE_VERSION) {
    return { ok: false, error: `unsupported bundleVersion (expected ${BUNDLE_VERSION})` };
  }
  if (!Array.isArray(b.categoryDefs)) return { ok: false, error: "categoryDefs must be an array" };
  if (!Array.isArray(b.participants)) return { ok: false, error: "participants must be an array" };
  const s = b.settings;
  if (!s || typeof s !== "object") return { ok: false, error: "settings missing" };
  const ss = s as Record<string, unknown>;
  if (typeof ss.subcategorySize !== "number") return { ok: false, error: "settings.subcategorySize missing" };
  if (typeof ss.disciplineMode !== "string") return { ok: false, error: "settings.disciplineMode missing" };
  if (typeof ss.areaCount !== "number") return { ok: false, error: "settings.areaCount missing" };
  if (b.logoDataUrl !== null && typeof b.logoDataUrl !== "string") {
    return { ok: false, error: "logoDataUrl must be a string or null" };
  }
  if (typeof b.logoDataUrl === "string" && !b.logoDataUrl.startsWith("data:")) {
    return { ok: false, error: "logoDataUrl must be a data: URL" };
  }

  const serialized = JSON.stringify(b);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes > MAX_BUNDLE_BYTES) {
    return { ok: false, error: `bundle too large (${Math.round(sizeBytes / 1024)} KB, max ${Math.round(MAX_BUNDLE_BYTES / 1024)} KB)` };
  }

  // Bundle's shape is OK; widen the type.
  const bundle: TournamentBundle = {
    bundleVersion: BUNDLE_VERSION,
    label: typeof b.label === "string" ? b.label : undefined,
    preparedAt: typeof b.preparedAt === "string" ? b.preparedAt : undefined,
    categoryDefs: b.categoryDefs,
    participants: b.participants,
    settings: {
      subcategorySize: ss.subcategorySize as number,
      disciplineMode: ss.disciplineMode as BundleSettings["disciplineMode"],
      areaCount: ss.areaCount as number,
      pointDifference: typeof ss.pointDifference === "number" ? ss.pointDifference : undefined,
    },
    logoDataUrl: (b.logoDataUrl as string | null) ?? null,
  };
  return { ok: true, bundle, sizeBytes };
}

interface StoredBundle {
  bundle: TournamentBundle;
  meta: BundleMeta;
}

export async function storeBundle(codeId: string, bundle: TournamentBundle, sizeBytes: number): Promise<BundleMeta> {
  const meta: BundleMeta = {
    label: bundle.label ?? null,
    preparedAt: bundle.preparedAt ?? null,
    participantCount: bundle.participants.length,
    categoryCount: bundle.categoryDefs.length,
    hasLogo: !!bundle.logoDataUrl,
    sizeBytes,
    storedAt: Date.now(),
  };
  await kv.set(keys.bundleByCodeId(codeId), { bundle, meta });
  return meta;
}

export async function getBundle(codeId: string): Promise<TournamentBundle | null> {
  const stored = await kv.get<StoredBundle>(keys.bundleByCodeId(codeId));
  return stored?.bundle ?? null;
}

export async function getBundleMeta(codeId: string): Promise<BundleMeta | null> {
  const stored = await kv.get<StoredBundle>(keys.bundleByCodeId(codeId));
  return stored?.meta ?? null;
}

export async function deleteBundle(codeId: string): Promise<void> {
  await kv.del(keys.bundleByCodeId(codeId));
}
