// Token-request lifecycle. KV-backed.

import { createHash, randomBytes, randomUUID } from "crypto";
import { kv, keys } from "./kv";

export type RequestStatus = "draft" | "pending" | "granted" | "rejected";

export interface TokenRequest {
  id: string;
  email: string;
  org: string | null;
  tournamentDate: string | null;
  notes: string | null;
  status: RequestStatus;
  createdAt: number;
  /** When the client clicked "Enviar" (draft → pending). */
  submittedAt: number | null;
  accessTokenHash: string;   // SHA-256 of the accessToken handed back to the requester
  codeId: string | null;     // populated once granted
  // Raw 6-digit code, stored ONLY here so the requester's pending
  // page can show it. This row is access-gated by the cookie/key
  // pair (see authorizeAccess). The general code store keeps only
  // SHA-256 hashes.
  rawCode: string | null;
  reviewedAt: number | null;
  /** GitHub id of the superadmin who granted or rejected. */
  decidedBy: string | null;
  rejectionReason: string | null;
}

function hashAccess(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateInput {
  email: string;
  org?: string;
  tournamentDate?: string;
  notes?: string;
  /**
   * Initial status. Legacy callers (the old /api/request-token endpoint)
   * pass "pending" so a request is admin-visible immediately. The new
   * wizard flow passes "draft" so the client can keep editing the
   * attached bundle before exposing the request to the admin.
   */
  status?: "draft" | "pending";
}

export async function createRequest(
  input: CreateInput,
): Promise<{ id: string; accessToken: string; record: TokenRequest }> {
  const id = randomUUID();
  const accessToken = randomBytes(24).toString("base64url");
  const status: RequestStatus = input.status ?? "pending";
  const record: TokenRequest = {
    id,
    email: input.email.trim().toLowerCase(),
    org: input.org?.trim() || null,
    tournamentDate: input.tournamentDate?.trim() || null,
    notes: input.notes?.trim() || null,
    status,
    createdAt: Date.now(),
    submittedAt: status === "pending" ? Date.now() : null,
    accessTokenHash: hashAccess(accessToken),
    codeId: null,
    rawCode: null,
    reviewedAt: null,
    decidedBy: null,
    rejectionReason: null,
  };
  await kv.set(keys.request(id), record);
  if (status === "pending") await kv.sadd(keys.pendingSet, id);
  return { id, accessToken, record };
}

export interface PatchInput {
  email?: string;
  org?: string | null;
  tournamentDate?: string | null;
  notes?: string | null;
}

/** Patch the contact fields on a draft request. No-op once submitted. */
export async function patchRequestContact(id: string, patch: PatchInput): Promise<TokenRequest | null> {
  const cur = await getRequest(id);
  if (!cur) return null;
  if (cur.status !== "draft") return cur; // immutable after submit
  const next: TokenRequest = {
    ...cur,
    email: patch.email != null ? patch.email.trim().toLowerCase() : cur.email,
    org: patch.org !== undefined ? (patch.org?.trim() || null) : cur.org,
    tournamentDate: patch.tournamentDate !== undefined
      ? (patch.tournamentDate?.trim() || null) : cur.tournamentDate,
    notes: patch.notes !== undefined ? (patch.notes?.trim() || null) : cur.notes,
  };
  await kv.set(keys.request(id), next);
  return next;
}

/** Flip draft → pending; adds to the admin queue. */
export async function markSubmitted(id: string): Promise<TokenRequest | null> {
  const cur = await getRequest(id);
  if (!cur) return null;
  if (cur.status !== "draft") return cur;
  const next: TokenRequest = { ...cur, status: "pending", submittedAt: Date.now() };
  await kv.set(keys.request(id), next);
  await kv.sadd(keys.pendingSet, id);
  return next;
}

/** Delete a request entirely. Used by the client "start over" path. */
export async function deleteRequest(id: string): Promise<void> {
  await kv.srem(keys.pendingSet, id);
  await kv.del(keys.request(id));
}

export async function getRequest(id: string): Promise<TokenRequest | null> {
  return await kv.get<TokenRequest>(keys.request(id));
}

export async function authorizeAccess(
  id: string,
  accessToken: string,
): Promise<TokenRequest | null> {
  const req = await getRequest(id);
  if (!req) return null;
  if (req.accessTokenHash !== hashAccess(accessToken)) return null;
  return req;
}

export async function listPending(): Promise<TokenRequest[]> {
  const ids = (await kv.smembers(keys.pendingSet)) as string[];
  if (ids.length === 0) return [];
  const rows = await Promise.all(ids.map((id) => kv.get<TokenRequest>(keys.request(id))));
  return rows.filter((r): r is TokenRequest => r !== null).sort((a, b) => a.createdAt - b.createdAt);
}

export async function markGranted(
  id: string,
  codeId: string,
  rawCode: string,
  decidedBy?: string,
): Promise<TokenRequest | null> {
  const cur = await getRequest(id);
  if (!cur || cur.status !== "pending") return null;
  const next: TokenRequest = {
    ...cur,
    status: "granted",
    codeId,
    rawCode,
    reviewedAt: Date.now(),
    decidedBy: decidedBy ?? cur.decidedBy ?? null,
  };
  await kv.set(keys.request(id), next);
  await kv.srem(keys.pendingSet, id);
  return next;
}

export async function markRejected(id: string, reason?: string, decidedBy?: string): Promise<TokenRequest | null> {
  const cur = await getRequest(id);
  if (!cur || cur.status !== "pending") return null;
  const next: TokenRequest = {
    ...cur,
    status: "rejected",
    reviewedAt: Date.now(),
    rejectionReason: reason ?? null,
    decidedBy: decidedBy ?? cur.decidedBy ?? null,
  };
  await kv.set(keys.request(id), next);
  await kv.srem(keys.pendingSet, id);
  return next;
}
