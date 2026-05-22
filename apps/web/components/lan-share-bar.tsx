"use client";

// Small one-liner bar that surfaces the host machine's LAN URL so the
// operator can read it aloud or copy it for guests. Only shows when
// the page is open on the host itself (hostname === localhost) AND
// the route isn't the public-display surface — projectors / audience
// monitors shouldn't show operator chrome.

import { useEffect, useState } from "react";

interface DiscoverResp {
  serverIps: string[];
  serverPort: number;
}

export function LanShareBar() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // /public is the audience-facing scoreboard. Operator chrome
    // doesn't belong there.
    if (window.location.pathname.startsWith("/public")) { setHidden(true); return; }
    const host = window.location.hostname;
    // Only show on the host machine — remote viewers don't need their
    // own LAN URL surfaced back to them.
    if (host !== "localhost" && host !== "127.0.0.1") { setHidden(true); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/discover", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as DiscoverResp;
        if (!alive) return;
        const ip = j.serverIps?.[0];
        if (!ip) return;
        setUrl(`http://${ip}:${j.serverPort}`);
      } catch {
        /* server not running through the bridge route — silently skip */
      }
    })();
    return () => { alive = false; };
  }, []);

  if (hidden || !url) return null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="lan-share">
      <span className="lan-share-label">Join from LAN</span>
      <code className="lan-share-url">{url}</code>
      <button
        type="button"
        className="lan-share-copy"
        onClick={copy}
        aria-label="Copy LAN URL"
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}
