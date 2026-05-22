import * as path from "path";
import * as os from "os";
import type { Role, Feature } from "@karate/core";

export interface LaunchConfig {
  issuedAt: number;
  expiresAt: number;
  sessionTtlSeconds?: number;
  role: Role;
  data: Record<string, unknown>;
}

export interface ServerConfig {
  dataDir: string;
  port: number;
  staticDir?: string | null;
  launchConfig?: LaunchConfig | null;
  seedClaimCodes: Array<{ code: string; role: Role; features: Feature[]; label: string }>;
}

export function defaultDataDir(): string {
  if (process.env.KARATE_DATA_DIR) return process.env.KARATE_DATA_DIR;
  // When running as a distributed binary, persist under ~/.kumiteos/data
  // so re-installs / upgrades don't wipe state. Detect "distributed"
  // mode by absence of a sibling package.json (dev tree has one).
  const devData = path.resolve(process.cwd(), "data");
  const devPkg = path.resolve(process.cwd(), "package.json");
  try {
    require("fs").accessSync(devPkg);
    return devData;
  } catch {
    return path.join(os.homedir(), ".kumiteos", "data");
  }
}

export function defaultStaticDir(): string {
  if (process.env.KARATE_STATIC_DIR) return process.env.KARATE_STATIC_DIR;
  // Resolution order, first existing wins:
  //   1. <execPath>/web/                — packaged binary layout (tarball)
  //   2. <__dirname>/../embedded/web/   — bun-compile or staged build
  //   3. <__dirname>/../../web/out/     — dev tree (apps/local/dist → apps/web/out)
  //   4. <cwd>/apps/web/out/            — monorepo root invocation
  const fs = require("fs") as typeof import("fs");
  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(execDir, "web"),
    path.resolve(__dirname, "..", "embedded", "web"),
    path.resolve(__dirname, "..", "..", "web", "out"),
    path.resolve(process.cwd(), "apps", "web", "out"),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  // Return the dev path even if missing — the caller logs that web UI
  // is unavailable rather than crashing.
  return candidates[2]!;
}

const FULL_SUPERADMIN: Feature[] = [
  "scoring",
  "public_display",
  "bracket_view",
  "tournament_config",
  "logo_upload",
  "user_management",
  "activity_log",
];

const FULL_REFEREE: Feature[] = ["scoring", "public_display", "bracket_view"];

export function defaultConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    dataDir: overrides.dataDir ?? defaultDataDir(),
    port: overrides.port ?? Number(process.env.KARATE_PORT ?? 4747),
    staticDir: overrides.staticDir ?? defaultStaticDir(),
    launchConfig: overrides.launchConfig ?? null,
    seedClaimCodes: overrides.seedClaimCodes ?? [],
  };
}

export const FEATURE_PRESETS = {
  superadmin: FULL_SUPERADMIN,
  referee: FULL_REFEREE,
};

export const PATHS = {
  keys: "keys",
  privateKey: "keys/ed25519-private.pem",
  publicKey: "keys/ed25519-public.pem",
  licenses: "licenses.json",
  data: "tournament.json",
  activity: "activity.log",
  uploads: "uploads",
  logo: "uploads/logo",
  downloads: "downloads",
};
