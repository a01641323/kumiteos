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
  // In the web build the server lives next to a ./data/ directory on
  // its own working tree. Fall back to the home directory if cwd isn't
  // writable (e.g. running from a read-only install).
  return path.resolve(process.cwd(), "data");
}

export function defaultStaticDir(): string {
  // apps/server/dist/standalone.js → ../../web/out
  return path.resolve(__dirname, "..", "..", "web", "out");
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
