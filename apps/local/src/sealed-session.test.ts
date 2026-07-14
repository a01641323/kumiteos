import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  seal,
  unseal,
  loadInstallKey,
  readState,
  writeState,
  deleteState,
  STATE_FILE,
  type SealedSessionState,
} from "./sealed-session";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sealed-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const sample: SealedSessionState = {
  sub: "u_123",
  issuedAt: 1000,
  expiresAt: 5000,
  highWater: 2000,
  budgetUsedMs: 500,
};

describe("sealed-session", () => {
  it("seals and unseals a round trip", () => {
    const key = loadInstallKey(dir);
    const container = seal(sample, key);
    expect(unseal(container, key)).toEqual(sample);
  });

  it("rejects a tampered payload (any byte change breaks the MAC)", () => {
    const key = loadInstallKey(dir);
    const container = seal(sample, key);
    container.payload.budgetUsedMs = 0; // hand-edit
    expect(unseal(container, key)).toBeNull();
  });

  it("rejects a wrong key", () => {
    const container = seal(sample, loadInstallKey(dir));
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "sealed2-"));
    const wrongKey = loadInstallKey(otherDir);
    expect(unseal(container, wrongKey)).toBeNull();
    fs.rmSync(otherDir, { recursive: true, force: true });
  });

  it("loadInstallKey is stable across calls and 64 hex chars", () => {
    const a = loadInstallKey(dir);
    const b = loadInstallKey(dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writeState then readState returns the payload", () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, sample);
    expect(readState(dir, key)).toEqual(sample);
  });

  it("readState deletes the file and returns null on integrity failure", () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, sample);
    const file = path.join(dir, "keys", STATE_FILE);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw.payload.budgetUsedMs = 999999; // corrupt on disk
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(readState(dir, key)).toBeNull();
    expect(fs.existsSync(file)).toBe(false); // deleted on sight
  });

  it("deleteState removes the file", () => {
    const key = loadInstallKey(dir);
    writeState(dir, key, sample);
    deleteState(dir);
    expect(readState(dir, key)).toBeNull();
  });
});
