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
export const MAX_BUNDLE_BYTES = 600 * 1024;

/** Compute the serialized byte size of a bundle for the size meter. */
export function bundleByteSize(bundle: unknown): number {
  return Buffer.byteLength(JSON.stringify(bundle ?? {}), "utf8");
}

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

export interface ValidateOptions {
  /**
   * Partial mode allows incomplete bundles (draft autosaves). Missing
   * top-level arrays default to []; missing settings fields default to
   * sensible empties. The size cap is still enforced.
   */
  partial?: boolean;
}

/**
 * Shape-check a parsed JSON value. Does not verify semantic
 * correctness (bracket sanity, name uniqueness, etc) — the local
 * applier will surface any logic problems when it rebuilds.
 *
 * Pass `{ partial: true }` for draft autosaves (relaxed validation).
 */
export function validateBundle(raw: unknown, opts: ValidateOptions = {}): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "bundle must be a JSON object" };
  }
  const b = raw as Record<string, unknown>;
  const partial = opts.partial === true;

  if (b.bundleVersion !== BUNDLE_VERSION) {
    return { ok: false, error: `unsupported bundleVersion (expected ${BUNDLE_VERSION})` };
  }

  const categoryDefs = Array.isArray(b.categoryDefs) ? b.categoryDefs : (partial ? [] : null);
  if (categoryDefs === null) return { ok: false, error: "categoryDefs must be an array" };

  const participants = Array.isArray(b.participants) ? b.participants : (partial ? [] : null);
  if (participants === null) return { ok: false, error: "participants must be an array" };

  const s = b.settings && typeof b.settings === "object" ? b.settings : (partial ? {} : null);
  if (s === null) return { ok: false, error: "settings missing" };
  const ss = s as Record<string, unknown>;

  const subcategorySize = typeof ss.subcategorySize === "number" ? ss.subcategorySize : (partial ? 4 : NaN);
  if (!Number.isFinite(subcategorySize)) return { ok: false, error: "settings.subcategorySize missing" };
  const disciplineMode = typeof ss.disciplineMode === "string" ? ss.disciplineMode : (partial ? "both" : null);
  if (disciplineMode === null) return { ok: false, error: "settings.disciplineMode missing" };
  const areaCount = typeof ss.areaCount === "number" ? ss.areaCount : (partial ? 1 : NaN);
  if (!Number.isFinite(areaCount)) return { ok: false, error: "settings.areaCount missing" };

  if (b.logoDataUrl !== null && b.logoDataUrl !== undefined && typeof b.logoDataUrl !== "string") {
    return { ok: false, error: "logoDataUrl must be a string or null" };
  }
  if (typeof b.logoDataUrl === "string" && b.logoDataUrl.length > 0 && !b.logoDataUrl.startsWith("data:")) {
    return { ok: false, error: "logoDataUrl must be a data: URL" };
  }

  // Strict-mode (submit/grant) requires at least one category and one participant.
  if (!partial) {
    if (categoryDefs.length === 0) return { ok: false, error: "al menos una categoría es requerida" };
    if (participants.length === 0) return { ok: false, error: "al menos un participante es requerido" };
  }

  // Widen the type.
  const bundle: TournamentBundle = {
    bundleVersion: BUNDLE_VERSION,
    label: typeof b.label === "string" ? b.label : undefined,
    preparedAt: typeof b.preparedAt === "string" ? b.preparedAt : undefined,
    categoryDefs,
    participants,
    settings: {
      subcategorySize,
      disciplineMode: disciplineMode as BundleSettings["disciplineMode"],
      areaCount,
      pointDifference: typeof ss.pointDifference === "number" ? ss.pointDifference : undefined,
    },
    logoDataUrl: (typeof b.logoDataUrl === "string" && b.logoDataUrl.length > 0)
      ? b.logoDataUrl
      : null,
  };

  const serialized = JSON.stringify(bundle);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes > MAX_BUNDLE_BYTES) {
    return { ok: false, error: `bundle too large (${Math.round(sizeBytes / 1024)} KB, max ${Math.round(MAX_BUNDLE_BYTES / 1024)} KB)` };
  }

  return { ok: true, bundle, sizeBytes };
}

/** A fresh empty bundle the wizard starts from. */
export function emptyBundle(): TournamentBundle {
  return {
    bundleVersion: BUNDLE_VERSION,
    label: undefined,
    preparedAt: undefined,
    categoryDefs: [],
    participants: [],
    settings: { subcategorySize: 4, disciplineMode: "both", areaCount: 1, pointDifference: 8 },
    logoDataUrl: null,
  };
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

// ---------- Request-scoped (draft) bundle storage ----------
//
// While a request is in `draft` status the bundle the client is
// editing lives under a separate key so the admin-visible request
// row stays small. On approval the bundle is moved to bundleByCodeId
// and the draft key is dropped.

interface StoredRequestBundle {
  bundle: TournamentBundle;
  meta: BundleMeta;
}

export async function storeRequestBundle(
  requestId: string,
  bundle: TournamentBundle,
  sizeBytes: number,
): Promise<BundleMeta> {
  const meta: BundleMeta = {
    label: bundle.label ?? null,
    preparedAt: bundle.preparedAt ?? null,
    participantCount: bundle.participants.length,
    categoryCount: bundle.categoryDefs.length,
    hasLogo: !!bundle.logoDataUrl,
    sizeBytes,
    storedAt: Date.now(),
  };
  await kv.set(keys.requestBundleById(requestId), { bundle, meta });
  return meta;
}

export async function getRequestBundle(requestId: string): Promise<TournamentBundle | null> {
  const stored = await kv.get<StoredRequestBundle>(keys.requestBundleById(requestId));
  return stored?.bundle ?? null;
}

export async function getRequestBundleMeta(requestId: string): Promise<BundleMeta | null> {
  const stored = await kv.get<StoredRequestBundle>(keys.requestBundleById(requestId));
  return stored?.meta ?? null;
}

export async function deleteRequestBundle(requestId: string): Promise<void> {
  await kv.del(keys.requestBundleById(requestId));
}
