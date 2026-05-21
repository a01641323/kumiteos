import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { readJsonSafe, writeJson, ensureDir } from "./storage";

export interface TournamentDataFile {
  version: number;
  updatedAt: number;
  data: Record<string, unknown>;
  etag: string;
}

const FILE_VERSION = 1;

function dataPath(dataDir: string): string {
  return path.join(dataDir, "tournament.json");
}

function computeEtag(payload: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

export function loadData(dataDir: string): TournamentDataFile {
  const fallback: TournamentDataFile = {
    version: FILE_VERSION,
    updatedAt: Date.now(),
    data: {},
    etag: "",
  };
  const file = readJsonSafe<TournamentDataFile>(dataPath(dataDir), fallback);
  if (!file.etag) file.etag = computeEtag(file.data);
  return file;
}

export function saveData(dataDir: string, data: Record<string, unknown>): TournamentDataFile {
  const file: TournamentDataFile = {
    version: FILE_VERSION,
    updatedAt: Date.now(),
    data,
    etag: computeEtag(data),
  };
  writeJson(dataPath(dataDir), file);
  return file;
}

export interface LogoInfo {
  filename: string;
  mime: string;
  size: number;
  url: string;
}

export function logoDir(dataDir: string): string {
  return path.join(dataDir, "uploads", "logo");
}

export function readLogoInfo(dataDir: string): LogoInfo | null {
  const dir = logoDir(dataDir);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
  if (files.length === 0) return null;
  const filename = files[0]!;
  const stat = fs.statSync(path.join(dir, filename));
  const ext = path.extname(filename).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".svg" ? "image/svg+xml" :
    "application/octet-stream";
  return {
    filename,
    mime,
    size: stat.size,
    url: `/api/logo`,
  };
}

export function clearLogo(dataDir: string): void {
  const dir = logoDir(dataDir);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, f));
  }
}

export function ensureLogoDir(dataDir: string): string {
  const dir = logoDir(dataDir);
  ensureDir(dir);
  return dir;
}
