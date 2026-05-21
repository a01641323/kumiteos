// Optimistic score overlay. Only SCORE_POINT actions feed this layer; all
// other referee/admin actions wait for server confirmation per the spec.
//
// Invariant: display = base + Σ pending entries' (side, n) deltas.
// Reconciliation rules:
//   - ACTION_ACK received          → no-op (server hasn't broadcast state yet)
//   - STATE patch arrives          → drop entries whose newVersion ≤ stateVersion
//   - ACTION_REJECTED              → drop the matching actionId, snap back
//   - 1.5s timeout with no ack     → drop the matching actionId, snap back
//
// Dropping happens at the renderer level. The server's broadcast already
// includes the canonical points, so subtracting the optimistic delta is
// simply "delete entry" — no arithmetic needed.

export interface OptimisticEntry {
  side: "blue" | "red";
  n: number;
  newVersionExpected: number | null; // set on ACK, null while pending
  queuedAt: number;
}

export type OptimisticMap = Map<string, OptimisticEntry>;

export const OPTIMISTIC_TIMEOUT_MS = 1500;

export function addEntry(map: OptimisticMap, actionId: string, entry: OptimisticEntry): OptimisticMap {
  const next = new Map(map);
  next.set(actionId, entry);
  return next;
}

export function applyAck(map: OptimisticMap, actionId: string, newVersion: number): OptimisticMap {
  if (!map.has(actionId)) return map;
  const next = new Map(map);
  const entry = next.get(actionId)!;
  next.set(actionId, { ...entry, newVersionExpected: newVersion });
  return next;
}

export function applyReject(map: OptimisticMap, actionId: string): OptimisticMap {
  if (!map.has(actionId)) return map;
  const next = new Map(map);
  next.delete(actionId);
  return next;
}

export function applyTimeout(map: OptimisticMap, actionId: string): OptimisticMap {
  return applyReject(map, actionId);
}

/** Drop every entry whose acknowledged newVersion ≤ stateVersion. */
export function reconcileWithState(map: OptimisticMap, stateVersion: number): OptimisticMap {
  let changed = false;
  const next = new Map(map);
  for (const [id, entry] of map) {
    if (entry.newVersionExpected != null && entry.newVersionExpected <= stateVersion) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : map;
}

export function deltaForSide(map: OptimisticMap, side: "blue" | "red"): number {
  let sum = 0;
  for (const e of map.values()) if (e.side === side) sum += e.n;
  return sum;
}
