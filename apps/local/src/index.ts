import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { type ServerConfig, defaultConfig } from "./config";
import { ensureDir } from "./storage";
import { loadOrCreateKeys, fetchCloudPublicKey, type KeyPair } from "./keys";
import { buildRoutes } from "./routes";
import { LicenseStore } from "./licenses";
import { signLicenseToken } from "./auth";
import { saveData } from "./data-store";
import type { KioskSession } from "@karate/core";
import { createNetworkController, type NetworkController } from "./network/controller";
import { buildNetworkRoutes } from "./network/routes";
import { createSessionManager, type LockReason } from "./session-manager";
import { DEFAULT_OFFLINE_GRACE_MS } from "./session-guard";

export interface KarateServer {
  app: Express;
  httpServer: http.Server;
  config: ServerConfig;
  keys: KeyPair;
  kioskSession: KioskSession | null;
  licenses: LicenseStore;
  publicKeySpki: string;
  network: NetworkController;
  getHostLockReason(): LockReason | null;
  start(): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;
}

export interface CreateServerOverrides extends Partial<ServerConfig> {
  localAdminToken?: () => string | null;
}

export async function createServer(
  overrides: CreateServerOverrides = {}
): Promise<KarateServer> {
  const config = defaultConfig(overrides);
  ensureDir(config.dataDir);
  ensureDir(path.join(config.dataDir, "uploads"));
  const keys = await loadOrCreateKeys(config.dataDir);
  const cloudUrl = process.env.KARATE_CLOUD_URL?.replace(/\/+$/, "");
  if (cloudUrl) {
    const cloud = await fetchCloudPublicKey(cloudUrl, config.dataDir);
    if (cloud) {
      keys.publicKey = cloud.key;
      keys.publicKeySpki = cloud.pem;
      // eslint-disable-next-line no-console
      console.log(`[karate-local] verifying JWTs with cloud public key from ${cloudUrl}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[karate-local] cloud public key unavailable; cloud-issued JWTs will fail to verify`,
      );
    }
  }
  const licenses = new LicenseStore(config.dataDir);

  for (const seed of config.seedClaimCodes) {
    licenses.seedCode(seed.code, {
      role: seed.role, features: seed.features, label: seed.label,
    });
  }

  let kioskSession: KioskSession | null = null;
  if (config.launchConfig) {
    const lc = config.launchConfig;
    if (lc.expiresAt > Date.now()) {
      saveData(config.dataDir, lc.data);
      const features = ["scoring", "public_display", "bracket_view"] as const;
      const userId = "kiosk_" + Math.random().toString(36).slice(2, 10);
      const { token, payload } = await signLicenseToken(
        { config, keys, licenses },
        {
          userId, role: "referee", features: [...features], plan: "referee",
          machineFingerprint: "kiosk-no-fp",
          activatedAt: Math.floor(Date.now() / 1000),
          ttlSeconds: lc.sessionTtlSeconds ?? Math.floor((lc.expiresAt - Date.now()) / 1000),
        }
      );
      kioskSession = {
        token, issuedAt: payload.iat * 1000, expiresAt: payload.exp * 1000,
        user: { role: "referee", features: [...features] },
      };
    }
  }

  // Rotating local-admin token. The /api/local-admin/issue endpoint hands
  // it out, gated by a loopback check. The localAdmin middleware verifies
  // it against this in-memory value.
  let localAdminToken: string | null = null;
  function rotateLocalAdminToken(): string {
    localAdminToken = crypto.randomBytes(32).toString("hex");
    return localAdminToken;
  }
  function getLocalAdminToken(): string | null {
    return overrides.localAdminToken ? overrides.localAdminToken() : localAdminToken;
  }

  // Offline anti-tamper guard. Records the host license window at activation
  // and enforces it every 5s against the monotonic clock + a sealed high-water
  // mark. On a failing verdict it force-drops every LAN client and latches a
  // lock reason the web UI reads via GET /api/session/status.
  let hostLockReason: LockReason | null = null;
  const sessionManager = createSessionManager({
    dataDir: config.dataDir,
    onEnforced: (reason) => {
      hostLockReason = reason;
      // `network` is defined just below; guarded because onEnforced can fire on start().
      try { network.disconnectAll(reason === "CLOCK_TAMPER" ? "clock_tamper" : "expired"); } catch {}
    },
  });

  const observeLicense = (sub: string, iatSeconds: number, expSeconds: number) => {
    hostLockReason = null;
    sessionManager.observe({
      sub,
      issuedAt: iatSeconds * 1000,
      expiresAt: expSeconds * 1000 + DEFAULT_OFFLINE_GRACE_MS,
    });
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(buildRoutes(config, keys, licenses, kioskSession, getLocalAdminToken, observeLicense));

  const httpServer = http.createServer(app);
  const network = createNetworkController({
    httpServer,
    dataDir: config.dataDir,
    isHostLicensed: () => sessionManager.isActive(),
  });
  app.use(buildNetworkRoutes(network, {
    issueLocalAdminToken: rotateLocalAdminToken,
    appVersion: "1.0.0",
    tournamentName: () => network.getState().state?.tournament?.activeCategoryId ?? null,
  }));

  // Anti-tamper lock status, polled by the web UI (same origin). null = active.
  app.get("/api/session/status", (_req, res) => {
    res.json({ locked: hostLockReason });
  });

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    const staticDir = config.staticDir;
    app.use(express.static(staticDir, { extensions: ["html"], index: "index.html" }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET") return next();
      if (req.path.startsWith("/api/") || req.path.startsWith("/admin-panel") || req.path.startsWith("/ws")) {
        return next();
      }
      const candidates = [
        path.join(staticDir, req.path, "index.html"),
        path.join(staticDir, "index.html"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) { res.sendFile(c); return; }
      }
      next();
    });
  }

  return {
    app,
    httpServer,
    config,
    keys,
    kioskSession,
    licenses,
    publicKeySpki: keys.publicKeySpki,
    network,
    getHostLockReason: () => hostLockReason,
    start() {
      return new Promise((resolve) => {
        httpServer.listen(config.port, "0.0.0.0", () => {
          network.start();
          sessionManager.start();
          const addr = httpServer.address();
          const port = typeof addr === "object" && addr ? addr.port : config.port;
          resolve({ port, url: `http://0.0.0.0:${port}` });
        });
      });
    },
    async stop() {
      sessionManager.stop();
      await network.stop();
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}

export type { ServerConfig } from "./config";
export type { KeyPair } from "./keys";
