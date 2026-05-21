"use client";

// Manual-IP connection screen. Shown when the same-origin WebSocket
// hasn't reached "welcomed" within a short window (e.g. the user
// opened the static build directly from disk, or auto-discovery on
// the LAN failed). Lets the user point the app at a different
// server's IP:port.

import { useEffect, useRef, useState } from "react";
import { useNetwork } from "@/lib/network-context";

const SERVER_URL_OVERRIDE_KEY = "karate.network.serverUrl";
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
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("4747");
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoverResp | null>(null);
  const armed = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arm a delay before showing the screen, so a normal page load that
  // connects in <10s never flickers the manual-IP UI.
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

  function connect() {
    setError(null);
    const trimmedIp = ip.trim();
    const portNum = Number(port);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmedIp) && !/^[a-zA-Z0-9.-]+$/.test(trimmedIp)) {
      setError("Enter a valid IPv4 address or hostname");
      return;
    }
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
      setError("Enter a valid port (1–65535)");
      return;
    }
    try {
      localStorage.setItem(SERVER_URL_OVERRIDE_KEY, `http://${trimmedIp}:${portNum}`);
    } catch {
      setError("Could not persist server URL — localStorage blocked.");
      return;
    }
    // Easiest way to pick up the new endpoint is a full reload — the
    // bridge installs once at boot and binds its transports then.
    window.location.reload();
  }

  if (!shown || status.welcomed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 text-white">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-zinc-900 p-6 shadow-2xl">
        <h2 className="mb-2 text-lg font-semibold">Can&apos;t reach the tournament server</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Auto-discovery hasn&apos;t connected yet. Enter the server&apos;s IP and port,
          or retry auto-discovery.
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-zinc-300">IP address</span>
          <input
            className="w-full rounded border border-white/10 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            placeholder="192.168.1.10"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            autoFocus
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-zinc-300">Port</span>
          <input
            className="w-full rounded border border-white/10 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
            onClick={connect}
          >
            Connect
          </button>
          <button
            className="rounded border border-white/10 bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-700"
            onClick={retryDiscovery}
          >
            Retry auto-discovery
          </button>
        </div>

        {discovered && (
          <div className="mt-4 rounded border border-white/5 bg-zinc-800/50 p-3 text-xs text-zinc-300">
            <div className="mb-1 font-medium text-zinc-200">Server reachable at:</div>
            <ul className="space-y-1">
              {discovered.serverIps.length === 0 && <li>(no LAN interfaces detected)</li>}
              {discovered.serverIps.map((sIp) => (
                <li key={sIp}>
                  <button
                    className="underline hover:text-white"
                    onClick={() => { setIp(sIp); setPort(String(discovered.serverPort)); }}
                  >
                    {sIp}:{discovered.serverPort}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
