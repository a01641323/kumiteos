import * as os from "os";
import { createServer } from "./index";

function localIPv4s(): string[] {
  const out: string[] = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    if (/^(utun|tailscale|tun|tap|zt|vEthernet|VMware|VirtualBox)/i.test(name)) continue;
    for (const info of ifs[name] ?? []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return out;
}

async function main() {
  const server = await createServer();
  const { port } = await server.start();
  // eslint-disable-next-line no-console
  console.log(`[karate-server] listening on http://0.0.0.0:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[karate-server] data dir: ${server.config.dataDir}`);
  // eslint-disable-next-line no-console
  console.log(`[karate-server] open on this machine:  http://localhost:${port}`);
  for (const ip of localIPv4s()) {
    // eslint-disable-next-line no-console
    console.log(`[karate-server] open on the LAN:       http://${ip}:${port}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[karate-server] admin panel: http://localhost:${port}/admin-panel`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[karate-server] failed to start:", err);
  process.exit(1);
});
