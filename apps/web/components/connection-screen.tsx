"use client";

// Fallback screen when the same-origin WebSocket doesn't reach
// "welcomed" within 10s. The previous version asked the user to type
// an IP / port — but the bridge already calls /api/discover at boot,
// so a manual IP form just duplicated UI for guests who would have
// connected anyway by simply navigating to the host's URL.
//
// We keep this screen as a soft "couldn't reach the server, here's
// the URL list we know about + a retry button" surface only.

import { useEffect, useRef, useState } from "react";
import { useNetwork } from "@/lib/network-context";

const SHOW_AFTER_MS = 10000;

interface DiscoverResp {
  serverIps: string[];
  serverPort: number;
  appVersion: string;
  tournamentName: string | null;
}

export function ConnectionScreen() {
  const { status } = useNetwork();
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoverResp | null>(null);
  const armed = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arm a delay before showing the screen so a normal load that
  // welcomes within 10s never flickers this UI.
  useEffect(() => {
    if (status.welcomed) {
      setShown(false);
      if (armed.current) { clearTimeout(armed.current); armed.current = null; }
      return;
    }
    if (armed.current) return;
    armed.current = setTimeout(() => { setShown(true); }, SHOW_AFTER_MS);
    return () => {
      if (armed.current) { clearTimeout(armed.current); armed.current = null; }
    };
  }, [status.welcomed]);

  async function retryDiscovery() {
    setError(null);
    try {
      const res = await fetch("/api/discover", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as DiscoverResp;
      setDiscovered(j);
    } catch (err: any) {
      setError(err?.message ?? "discovery failed");
    }
  }

  if (!shown || status.welcomed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 text-white">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-zinc-900 p-6 shadow-2xl">
        <h2 className="mb-2 text-lg font-semibold">Can&apos;t reach the tournament server</h2>
        <p className="mb-4 text-sm text-zinc-400">
          The host machine hasn&apos;t replied. Make sure the server is
          running on the same Wi-Fi and try again — or ask the operator
          for the LAN URL printed at the top of their admin screen.
        </p>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <button
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
          onClick={retryDiscovery}
        >
          Retry auto-discovery
        </button>

        {discovered && (
          <div className="mt-4 rounded border border-white/5 bg-zinc-800/50 p-3 text-xs text-zinc-300">
            <div className="mb-1 font-medium text-zinc-200">Server reachable at:</div>
            <ul className="space-y-1">
              {discovered.serverIps.length === 0 && <li>(no LAN interfaces detected)</li>}
              {discovered.serverIps.map((sIp) => (
                <li key={sIp}>
                  <a
                    href={`http://${sIp}:${discovered.serverPort}`}
                    className="underline hover:text-white"
                  >
                    http://{sIp}:{discovered.serverPort}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
