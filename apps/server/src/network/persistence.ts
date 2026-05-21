// Atomic-write debounced JSON persistence for the master tournament state.

import * as fs from "fs";
import * as path from "path";

const FILE = "tournament-state.json";
const META = "tournament-state.meta.json";
const FLUSH_MS = 250;

function statePath(dir: string) { return path.join(dir, FILE); }
function metaPath(dir: string) { return path.join(dir, META); }

export function load(dir: string): any | null {
  try { return JSON.parse(fs.readFileSync(statePath(dir), "utf8")); } catch { return null; }
}

export function loadMeta(dir: string): { stateVersion?: number; savedAt?: number } | null {
  try { return JSON.parse(fs.readFileSync(metaPath(dir), "utf8")); } catch { return null; }
}

function writeAtomic(targetPath: string, json: string) {
  const tmp = `${targetPath}.tmp`;
  let attempts = 0;
  for (;;) {
    try {
      fs.writeFileSync(tmp, json, { mode: 0o600 });
      fs.renameSync(tmp, targetPath);
      return;
    } catch (err: any) {
      if (attempts < 1 && err?.code === "EBUSY") {
        attempts += 1;
        const start = Date.now();
        while (Date.now() - start < 50) { /* spin */ }
        continue;
      }
      throw err;
    }
  }
}

export interface Persister {
  schedule(state: any, version: number): void;
  flushNow(): void;
}

export function makePersister(dir: string): Persister {
  let pending: { state: any; version: number } | null = null;
  let timer: NodeJS.Timeout | null = null;

  function flushNow() {
    if (!pending) return;
    const { state, version } = pending;
    pending = null;
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      writeAtomic(statePath(dir), JSON.stringify(state));
      writeAtomic(metaPath(dir), JSON.stringify({ stateVersion: version, savedAt: Date.now() }));
    } catch (err: any) {
      console.warn("[karate-network] state flush failed:", err?.message);
    }
  }

  function schedule(state: any, version: number) {
    pending = { state, version };
    if (timer) return;
    timer = setTimeout(() => { timer = null; flushNow(); }, FLUSH_MS);
  }

  return { schedule, flushNow };
}
