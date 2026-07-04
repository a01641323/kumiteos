import { Router, type Request, type Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import multer from "multer";
import type { ServerConfig } from "./config";
import { FEATURE_PRESETS } from "./config";
import type { KeyPair } from "./keys";
import {
  signLicenseToken,
  requireAuth,
  type AuthedRequest,
  type AuthDeps,
  JWT_TTL_SECONDS,
} from "./auth";
import { requireLocalAdmin } from "./local-admin-auth";
import type { LicenseStore } from "./licenses";
import type { KioskSession, Role, Feature } from "@karate/core";
import {
  loadData,
  saveData,
  readLogoInfo,
  clearLogo,
  ensureLogoDir,
  logoDir,
} from "./data-store";
import { logActivity, readActivity } from "./activity";
import { renderAdminPanelHtml, renderAdminLoginHtml } from "./admin-panel";
import { loadAppConfig, saveAppConfig } from "./app-config";
import { RateLimiter, clientIp } from "./rate-limit";

const execFileP = promisify(execFile);

export function buildRoutes(
  config: ServerConfig,
  keys: KeyPair,
  licenses: LicenseStore,
  kioskSession?: KioskSession | null,
  getLocalAdminToken: () => string | null = () => null,
  onLicenseObserved: (sub: string, iatSeconds: number, expSeconds: number) => void = () => {},
): Router {
  const deps: AuthDeps = { config, keys, licenses };
  const router = Router();
  const auth = requireAuth(deps);
  const localAdmin = requireLocalAdmin(getLocalAdminToken);

  // ---------------------------------------------------------------
  // Rate limiters
  // ---------------------------------------------------------------
  const activateLimiter = new RateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    key: (req) => clientIp(req),
    exponentialBackoff: true,
    countOnlyFailures: true,
  });

  const renewLimiter = new RateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    key: (req) => {
      const h = req.headers.authorization;
      if (h?.startsWith("Bearer ")) {
        // Hash the token so the key length stays bounded.
        return crypto
          .createHash("sha256")
          .update(h.slice(7))
          .digest("hex")
          .slice(0, 16);
      }
      return clientIp(req);
    },
  });

  const generalLimiter = new RateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    key: (req: AuthedRequest) =>
      req.auth?.sub ?? clientIp(req),
  });

  // ---------------------------------------------------------------
  // Public (unauthenticated) endpoints
  // ---------------------------------------------------------------
  router.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  router.get("/api/public-key", (_req, res) => {
    res.type("text/plain").send(keys.publicKeySpki);
  });

  // ---------------------------------------------------------------
  // POST /api/activate — redeem claim code, issue JWT
  //
  // Two modes:
  //   1. Cloud-proxy mode (KARATE_CLOUD_URL set): forward to the
  //      Vercel-hosted licensing authority. The cloud signs the JWT;
  //      this binary just verifies it later against the embedded
  //      public key (see lib/cloud-key, future PR).
  //   2. Local mode (no env var): legacy behavior — sign JWTs with
  //      this machine's own Ed25519 key against the in-process
  //      LicenseStore. Kept for dev so `pnpm dev` still works
  //      end-to-end without a deployed cloud.
  // ---------------------------------------------------------------
  // Default to the production cloud so `kumiteos` invoked from any
  // shell — not just via the installer's nohup wrapper — can proxy
  // activation. Setting KARATE_CLOUD_URL="" explicitly opts out
  // (legacy dev mode: sign JWTs locally against the in-process
  // LicenseStore).
  const envCloudUrl = process.env.KARATE_CLOUD_URL;
  const cloudUrl = (envCloudUrl === undefined
    ? "https://kumiteos.vercel.app"
    : envCloudUrl
  ).replace(/\/+$/, "");

  router.post(
    "/api/activate",
    activateLimiter.middleware,
    async (req: Request, res: Response) => {
      const ip = clientIp(req);
      const body = (req.body ?? {}) as { code?: unknown; machineFingerprint?: unknown };
      const rawCode =
        typeof body.code === "string" ? body.code.trim() : "";
      const machineFingerprint =
        typeof body.machineFingerprint === "string"
          ? body.machineFingerprint.trim()
          : "";

      // Cloud proxy mode.
      if (cloudUrl) {
        const upstreamUrl = `${cloudUrl}/api/activate`;
        try {
          // eslint-disable-next-line no-console
          console.log(`[karate-local] proxying /api/activate → ${upstreamUrl}`);
          const upstream = await fetch(upstreamUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: rawCode, machineFingerprint }),
          });
          const text = await upstream.text();
          res.status(upstream.status).type(upstream.headers.get("content-type") ?? "application/json").send(text);
          activateLimiter[upstream.ok ? "recordSuccess" : "recordFailure"](req);
          if (upstream.ok) {
            try {
              const parsed = JSON.parse(text) as { payload?: { sub?: string; jti?: string } };
              logActivity(config.dataDir, {
                ts: Date.now(), event: "ACTIVATION_SUCCESS",
                userId: parsed.payload?.sub ?? null,
                ip, machineFingerprint, jti: parsed.payload?.jti ?? null,
                result: "success", message: "cloud_proxy",
              });
            } catch { /* response wasn't JSON; still 200 */ }
            try {
              const parsed2 = JSON.parse(text) as { payload?: { sub?: string; iat?: number; exp?: number } };
              if (parsed2.payload?.sub && parsed2.payload.iat && parsed2.payload.exp) {
                onLicenseObserved(parsed2.payload.sub, parsed2.payload.iat, parsed2.payload.exp);
              }
            } catch { /* response wasn't JSON; guard simply isn't recorded */ }
          } else {
            logActivity(config.dataDir, {
              ts: Date.now(), event: "ACTIVATION_FAILURE", userId: null,
              ip, machineFingerprint, jti: null, result: "fail",
              reason: `cloud_${upstream.status}`,
            });
          }
        } catch (err) {
          activateLimiter.recordFailure(req);
          const detail = (err as Error)?.message ?? "fetch_failed";
          const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
          // eslint-disable-next-line no-console
          console.warn(
            `[karate-local] activate proxy failed → ${upstreamUrl}\n` +
              `  reason: ${detail}\n` +
              `  cause: ${cause?.code ?? "(none)"} ${cause?.message ?? ""}`,
          );
          logActivity(config.dataDir, {
            ts: Date.now(), event: "ACTIVATION_FAILURE", userId: null,
            ip, machineFingerprint, jti: null, result: "fail",
            reason: "cloud_unreachable",
          });
          res.status(502).json({
            error: "CLOUD_UNREACHABLE",
            message: "Cannot reach licensing server. Check internet and retry.",
            detail,
          });
        }
        return;
      }

      // Local mode (legacy).
      if (!/^\d{6}$/.test(rawCode)) {
        activateLimiter.recordFailure(req);
        logActivity(config.dataDir, {
          ts: Date.now(), event: "ACTIVATION_FAILURE", userId: null,
          ip, machineFingerprint, jti: null, result: "fail", reason: "CODE_NOT_FOUND",
        });
        res.status(400).json({ error: "CODE_NOT_FOUND" });
        return;
      }
      if (!/^[a-f0-9]{16,128}$/i.test(machineFingerprint)) {
        activateLimiter.recordFailure(req);
        res.status(400).json({ error: "INVALID_FINGERPRINT" });
        return;
      }

      const record = licenses.findByCode(rawCode);
      if (!record) {
        activateLimiter.recordFailure(req);
        logActivity(config.dataDir, {
          ts: Date.now(), event: "ACTIVATION_FAILURE", userId: null,
          ip, machineFingerprint, jti: null, result: "fail", reason: "CODE_NOT_FOUND",
        });
        res.status(404).json({ error: "CODE_NOT_FOUND" });
        return;
      }

      if (record.revoked) {
        activateLimiter.recordFailure(req);
        logActivity(config.dataDir, {
          ts: Date.now(), event: "ACTIVATION_FAILURE", userId: record.userId,
          ip, machineFingerprint, jti: null, result: "fail", reason: "ACCESS_REVOKED",
        });
        res.status(403).json({ error: "ACCESS_REVOKED" });
        return;
      }

      if (record.expiresAt < Date.now()) {
        activateLimiter.recordFailure(req);
        logActivity(config.dataDir, {
          ts: Date.now(), event: "ACTIVATION_FAILURE", userId: record.userId,
          ip, machineFingerprint, jti: null, result: "fail", reason: "CODE_EXPIRED",
        });
        res.status(410).json({ error: "CODE_EXPIRED" });
        return;
      }

      if (record.used && !record.reclaimable) {
        if (record.machineFingerprint !== machineFingerprint) {
          activateLimiter.recordFailure(req);
          logActivity(config.dataDir, {
            ts: Date.now(), event: "ACTIVATION_FAILURE", userId: record.userId,
            ip, machineFingerprint, jti: null, result: "fail", reason: "CODE_ALREADY_USED",
          });
          res.status(409).json({ error: "CODE_ALREADY_USED" });
          return;
        }
      }

      const activatedAt = record.activatedAt ?? Math.floor(Date.now() / 1000);
      const secondsUntilExpiry = Math.floor((record.expiresAt - Date.now()) / 1000);
      const { token, payload } = await signLicenseToken(deps, {
        userId: record.userId,
        role: record.role,
        features: record.features,
        plan: record.plan,
        machineFingerprint,
        activatedAt,
        ttlSeconds: Math.min(JWT_TTL_SECONDS, Math.max(60, secondsUntilExpiry)),
      });
      licenses.activate(record.codeId, machineFingerprint, payload.jti);
      onLicenseObserved(payload.sub, payload.iat, payload.exp);

      activateLimiter.recordSuccess(req);
      logActivity(config.dataDir, {
        ts: Date.now(), event: "ACTIVATION_SUCCESS", userId: record.userId,
        ip, machineFingerprint, jti: payload.jti, result: "success",
      });

      res.json({
        token,
        payload: {
          sub: payload.sub,
          role: payload.role,
          features: payload.features,
          plan: payload.plan,
          activated_at: payload.activated_at,
          exp: payload.exp,
          iat: payload.iat,
          jti: payload.jti,
        },
      });
    }
  );

  // ---------------------------------------------------------------
  // /api/renew-token — REMOVED. Per the per-tournament one-shot
  // licensing model, expired sessions force a new code from the
  // cloud. See docs/superpowers/specs/2026-05-20-vercel-licensing-
  // flow-design.md. The endpoint is intentionally absent so a stale
  // renderer surfaces a 404 and the lock screen takes over.
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // Tournament data
  // ---------------------------------------------------------------
  router.get("/api/me", auth, (req: AuthedRequest, res: Response) => {
    res.json({
      user: {
        role: req.auth!.role,
        features: req.auth!.features,
      },
      jti: req.auth!.jti,
      exp: req.auth!.exp,
    });
  });

  router.get(
    "/api/data",
    auth,
    generalLimiter.middleware,
    (_req: AuthedRequest, res: Response) => {
      const file = loadData(config.dataDir);
      res.set("ETag", file.etag);
      res.json(file);
    }
  );

  router.put("/api/data", localAdmin, (req: Request, res: Response) => {
    const incoming = req.body && typeof req.body === "object" ? req.body : null;
    if (!incoming) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const file = saveData(config.dataDir, incoming as Record<string, unknown>);
    logActivity(config.dataDir, {
      ts: Date.now(), event: "data_update", userId: "local-admin",
      ip: clientIp(req), jti: null, result: "success",
    });
    res.set("ETag", file.etag);
    res.json(file);
  });

  // ---------------------------------------------------------------
  // Logo upload
  // ---------------------------------------------------------------
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _f, cb) => cb(null, ensureLogoDir(config.dataDir)),
      filename: (_req, f, cb) => {
        const ext = path.extname(f.originalname).toLowerCase() || ".png";
        cb(null, `logo${ext}`);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, f, cb) => {
      const ok = ["image/png", "image/jpeg", "image/svg+xml"].includes(f.mimetype);
      if (!ok) return cb(new Error("Only PNG / JPG / SVG allowed"));
      cb(null, true);
    },
  });

  router.post(
    "/api/upload-logo",
    localAdmin,
    (req, res, next) => {
      upload.single("logo")(req, res, (err: unknown) => {
        if (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "upload_failed" });
          return;
        }
        next();
      });
    },
    (req: Request, res: Response) => {
      const dir = logoDir(config.dataDir);
      const keep = (req as Request & { file?: Express.Multer.File }).file?.filename;
      for (const f of fs.readdirSync(dir)) {
        if (f !== keep) fs.unlinkSync(path.join(dir, f));
      }
      const info = readLogoInfo(config.dataDir);
      logActivity(config.dataDir, {
        ts: Date.now(), event: "logo_upload", userId: "local-admin",
        ip: clientIp(req), jti: null, result: "success",
      });
      res.json({ logo: info });
    }
  );

  router.delete("/api/upload-logo", localAdmin, (req: Request, res: Response) => {
    clearLogo(config.dataDir);
    logActivity(config.dataDir, {
      ts: Date.now(), event: "logo_remove", userId: "local-admin",
      ip: clientIp(req), jti: null, result: "success",
    });
    res.json({ ok: true });
  });

  router.get("/api/logo", (_req, res) => {
    const info = readLogoInfo(config.dataDir);
    if (!info) {
      res.status(404).end();
      return;
    }
    res.type(info.mime);
    fs.createReadStream(path.join(logoDir(config.dataDir), info.filename)).pipe(res);
  });

  router.get("/api/logo-info", auth, (_req: AuthedRequest, res: Response) => {
    res.json({ logo: readLogoInfo(config.dataDir) });
  });

  // ---------------------------------------------------------------
  // Kiosk session (read-only)
  // ---------------------------------------------------------------
  router.get("/api/kiosk-session", (_req, res) => {
    if (!kioskSession) {
      res.status(404).json({ error: "not_kiosk" });
      return;
    }
    res.json(kioskSession);
  });

  // ---------------------------------------------------------------
  // Activity log (superadmin)
  // ---------------------------------------------------------------
  router.get("/api/activity", localAdmin, (req: Request, res: Response) => {
    const max = Math.min(Number(req.query.max ?? 200), 2000);
    res.json({ entries: readActivity(config.dataDir, max) });
  });

  // ---------------------------------------------------------------
  // App config (local admin)
  // ---------------------------------------------------------------
  router.get("/api/app-config", localAdmin, (_req: Request, res: Response) => {
    res.json(loadAppConfig(config.dataDir));
  });

  router.put("/api/app-config", localAdmin, (req: Request, res: Response) => {
    const { sessionTtlMinutes } = req.body ?? {};
    if (typeof sessionTtlMinutes !== "number" || sessionTtlMinutes < 1) {
      res.status(400).json({ error: "invalid_value" });
      return;
    }
    const cfg = { sessionTtlMinutes: Math.floor(sessionTtlMinutes) };
    saveAppConfig(config.dataDir, cfg);
    logActivity(config.dataDir, {
      ts: Date.now(), event: "access_extend", userId: "local-admin",
      ip: clientIp(req), jti: null, result: "success",
      message: `set sessionTtlMinutes=${cfg.sessionTtlMinutes}`,
    });
    res.json(cfg);
  });

  // ---------------------------------------------------------------
  // Admin license management (local admin)
  // Claim codes are referee-only; superadmin access is granted by the
  // local stealth chord (no role-bearing JWT involved).
  // ---------------------------------------------------------------
  // Read-only inspect of this machine's cached licenses. Useful for
  // support; safe to keep on the local app.
  router.get("/api/admin/licenses", localAdmin, (_req: Request, res: Response) => {
    res.json({ licenses: licenses.list() });
  });

  // Create / revoke / transfer / extend used to live here. They now
  // live on the Vercel-hosted cloud (apps/cloud). The local binary
  // intentionally cannot mint or rotate codes.

  // ---------------------------------------------------------------
  // Custom DMG builder (used by the superadmin to ship a pre-seeded
  // tournament). Kept from previous design; now authenticated by JWT.
  // ---------------------------------------------------------------
  async function createCustomDmg(
    baseDmgPath: string,
    launchConfig: Record<string, unknown>,
  ): Promise<string> {
    const tmpId      = crypto.randomUUID();
    const shadowFile = `/tmp/karate-shadow-${tmpId}.shadow`;
    const mountPoint = `/tmp/karate-mount-${tmpId}`;
    const outputBase = `/tmp/karate-out-${tmpId}`;

    fs.mkdirSync(mountPoint, { recursive: true });
    try {
      await execFileP("/usr/bin/hdiutil", [
        "attach", baseDmgPath,
        "-shadow", shadowFile,
        "-mountpoint", mountPoint,
        "-nobrowse", "-quiet",
      ]);
      const appName = fs.readdirSync(mountPoint).find((f) => f.endsWith(".app"));
      if (!appName) throw new Error("No .app found in DMG");
      const launchJson = JSON.stringify(launchConfig);
      fs.writeFileSync(path.join(mountPoint, "karate-launch.json"), launchJson);
      const resourcesDir = path.join(mountPoint, appName, "Contents", "Resources");
      if (fs.existsSync(resourcesDir)) {
        fs.writeFileSync(path.join(resourcesDir, "karate-launch.json"), launchJson);
      }
      await execFileP("/usr/bin/hdiutil", ["detach", mountPoint, "-quiet"]);
      await execFileP("/usr/bin/hdiutil", [
        "convert", baseDmgPath, "-shadow", shadowFile, "-format", "ULFO", "-o", outputBase,
      ]);
      return `${outputBase}.dmg`;
    } catch (err) {
      await execFileP("/usr/bin/hdiutil", ["detach", mountPoint, "-quiet"]).catch(() => {});
      throw err;
    } finally {
      fs.rmSync(mountPoint, { recursive: true, force: true });
      if (fs.existsSync(shadowFile)) fs.unlinkSync(shadowFile);
    }
  }

  const pendingDownloads = new Map<string, { launchConfig: Record<string, unknown>; createdAt: number }>();
  function prunePendingDownloads() {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [k, v] of pendingDownloads) {
      if (v.createdAt < cutoff) pendingDownloads.delete(k);
    }
  }

  router.post("/api/prepare-download", auth, async (req: AuthedRequest, res: Response) => {
    const dataFile = loadData(config.dataDir);
    const cfg = loadAppConfig(config.dataDir);
    const launchConfig = {
      issuedAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      sessionTtlSeconds: cfg.sessionTtlMinutes * 60,
      role: req.auth!.role,
      data: dataFile.data,
    };
    prunePendingDownloads();
    const tokenId = crypto.randomUUID();
    pendingDownloads.set(tokenId, { launchConfig, createdAt: Date.now() });
    logActivity(config.dataDir, {
      ts: Date.now(), event: "prepare_download", userId: req.auth!.sub,
      ip: clientIp(req), jti: req.auth!.jti, result: "success",
    });
    res.json({ tokenId });
  });

  router.get("/api/download-app/:tokenId", async (req: Request, res: Response) => {
    const entry = pendingDownloads.get(req.params.tokenId);
    if (!entry) { res.status(404).json({ error: "not_found" }); return; }
    pendingDownloads.delete(req.params.tokenId);
    const dmgInfo = scanDownloads();
    if (!dmgInfo.mac) { res.status(404).json({ error: "no_installer" }); return; }
    const baseDmgPath = path.join(downloadsDir(), dmgInfo.mac);
    let outputDmg: string | null = null;
    try {
      outputDmg = await createCustomDmg(baseDmgPath, entry.launchConfig);
      const stat = fs.statSync(outputDmg);
      res.setHeader("Content-Type", "application/x-apple-diskimage");
      res.setHeader("Content-Disposition", 'attachment; filename="KarateTournament.dmg"');
      res.setHeader("Content-Length", stat.size);
      const stream = fs.createReadStream(outputDmg);
      stream.pipe(res);
      res.on("finish", () => { if (outputDmg) try { fs.unlinkSync(outputDmg); } catch {} });
    } catch (err) {
      if (outputDmg) try { fs.unlinkSync(outputDmg); } catch {}
      if (!res.headersSent) res.status(500).json({ error: "build_failed", detail: String(err) });
    }
  });

  function downloadsDir(): string {
    return path.join(config.dataDir, "downloads");
  }
  function scanDownloads(): { mac: string | null; win: string | null } {
    const dir = downloadsDir();
    if (!fs.existsSync(dir)) return { mac: null, win: null };
    const files = fs.readdirSync(dir);
    const mac = files.find((f) => f.toLowerCase().endsWith(".dmg")) ?? null;
    const win = files.find((f) => f.toLowerCase().endsWith(".exe")) ?? null;
    return { mac, win };
  }
  router.get("/api/download-info", (_req, res) => { res.json(scanDownloads()); });
  router.get("/api/downloads/:filename", (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(downloadsDir(), filename);
    if (!fs.existsSync(filepath)) { res.status(404).json({ error: "not_found" }); return; }
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === ".dmg" ? "application/x-apple-diskimage"
      : ext === ".exe" ? "application/vnd.microsoft.portable-executable"
      : "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", fs.statSync(filepath).size);
    fs.createReadStream(filepath).pipe(res);
  });

  // ---------------------------------------------------------------
  // Admin panel HTML
  // ---------------------------------------------------------------
  router.get("/admin-panel", (_req, res) => {
    res.type("html").send(renderAdminPanelHtml());
  });
  router.get("/admin-panel/login", (_req, res) => {
    res.type("html").send(renderAdminLoginHtml());
  });

  return router;
}
