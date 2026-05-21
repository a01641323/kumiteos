// REST + SSE surface for the network controller.
//
// These endpoints replace the Electron IPC layer that used to back
// window.__KARATE__.network.* in the renderer. The WebSocket on /ws is
// still the primary state channel; these routes expose lifecycle/admin
// operations (approve / reject / disconnect / discover) plus an SSE
// stream so the browser shim can fan events out.

import { Router, type Request, type Response } from "express";
import * as os from "os";
import type { NetworkController } from "./controller";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(req: Request): boolean {
  const ip = req.socket.remoteAddress ?? "";
  return LOOPBACK.has(ip);
}

function localIPv4s(): string[] {
  const out: string[] = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    // Skip common VPN / virtual interfaces so the advertised IP is the
    // one LAN clients can actually reach.
    if (/^(utun|tailscale|tun|tap|zt|vEthernet|VMware|VirtualBox)/i.test(name)) continue;
    for (const info of ifs[name] ?? []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return out;
}

export function buildNetworkRoutes(
  network: NetworkController,
  opts: {
    issueLocalAdminToken: () => string;
    appVersion: string;
    tournamentName: () => string | null;
  }
): Router {
  const router = Router();

  router.get("/api/discover", (req: Request, res: Response) => {
    const port = Number(req.socket.localPort) || 4747;
    res.json({
      serverIps: localIPv4s(),
      serverPort: port,
      appVersion: opts.appVersion,
      tournamentName: opts.tournamentName(),
    });
  });

  // Loopback-only: chord handler in the browser POSTs here to get a
  // short-lived superadmin token. LAN clients cannot reach this.
  router.post("/api/local-admin/issue", (req: Request, res: Response) => {
    if (!isLoopback(req)) {
      res.status(403).json({ error: "loopback_only" });
      return;
    }
    const token = opts.issueLocalAdminToken();
    res.json({ token });
  });

  router.get("/api/network/status", (_req, res) => {
    res.json(network.getStatus());
  });

  router.get("/api/network/state", (_req, res) => {
    res.json(network.getState());
  });

  router.post("/api/network/import-local-state", (req: Request, res: Response) => {
    const result = network.importLocalState(req.body?.state ?? req.body);
    res.json(result);
  });

  router.post("/api/network/send-action", (req: Request, res: Response) => {
    const result = network.sendAction(req.body);
    res.json(result);
  });

  router.get("/api/network/pending", (_req, res) => {
    res.json({ pending: network.listPending() });
  });

  router.post("/api/network/pending/:clientId/approve", (req: Request, res: Response) => {
    res.json(network.approveConnection(req.params.clientId));
  });

  router.post("/api/network/pending/:clientId/reject", (req: Request, res: Response) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    res.json(network.rejectConnection(req.params.clientId, reason));
  });

  router.post("/api/network/disconnect-all", (_req, res) => {
    network.disconnectAll();
    res.json({ ok: true });
  });

  // Server-Sent Events stream. The browser shim opens this once and
  // re-emits each frame to the renderer-side listeners (connection
  // requests, status updates, action acks, state changes).
  router.get("/api/network/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (event: string, payload: unknown) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch { /* client gone */ }
    };
    send("status", network.getStatus());
    send("state", network.getState());
    const onStatus = (p: any) => send("status", p);
    const onState = (p: any) => send("state", p);
    const onConnReq = (p: any) => send("connection-request", p);
    const onAck = (p: any) => send("ack", p);
    const onRejected = (p: any) => send("rejected", p);
    network.events.on("status", onStatus);
    network.events.on("state", onState);
    network.events.on("connection-request", onConnReq);
    network.events.on("ack", onAck);
    network.events.on("rejected", onRejected);
    const keepalive = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch {}
    }, 25000);
    req.on("close", () => {
      clearInterval(keepalive);
      network.events.off("status", onStatus);
      network.events.off("state", onState);
      network.events.off("connection-request", onConnReq);
      network.events.off("ack", onAck);
      network.events.off("rejected", onRejected);
    });
  });

  return router;
}
