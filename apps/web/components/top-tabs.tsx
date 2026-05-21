"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { isElectron, apiGetDownloadInfo, apiPrepareDownload, getServerUrl, type DownloadInfo } from "@/lib/api-client";
import { NetworkStatusBadge } from "@/components/network-status-badge";
import { useStore } from "@/lib/store";

export function TopTabs() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { status, logout, isKiosk } = useAuth();
  const { state } = useStore();
  const [downloads, setDownloads] = useState<DownloadInfo | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Show the Check-in tab while at least one category has participants but
  // hasn't been started yet. Once every category is locked in, hide it
  // again for a cleaner mid-tournament UI.
  const showCheckIn = state.tournament.categoryOrder.some((id) => {
    const cat = state.tournament.categories[id];
    return cat && !cat.started && cat.competitors.length > 0;
  });

  useEffect(() => {
    if (isElectron() || status.kind !== "authed") return;
    apiGetDownloadInfo().then(setDownloads).catch(() => {});
  }, [status.kind]);

  async function handleDownloadApp() {
    if (!downloads?.mac || status.kind !== "authed") return;
    setDownloading(true);
    try {
      const { tokenId } = await apiPrepareDownload(status.session.token);
      const link = document.createElement("a");
      link.href = `${getServerUrl()}/api/download-app/${tokenId}`;
      link.download = "KarateTournament.dmg";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      alert("Error preparing download. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  // The public scoreboard view is chromeless.
  if (pathname.startsWith("/public")) return null;
  // Login / lock screens render their own chrome.
  if (status.kind === "loading" || status.kind === "anonymous" || status.kind === "locked") {
    return null;
  }

  // All claim codes are referee-only. Tournament configuration is reached via
  // the stealth chord overlay, not a top-tab.
  const tabs: { href: string; label: string; external?: boolean }[] = [
    { href: "/admin", label: "Admin" },
    ...(showCheckIn ? [{ href: "/check-in", label: "Check-in" }] : []),
    { href: "/private", label: "Private" },
    { href: "/public", label: "Public ↗", external: true },
  ];

  return (
    <nav id="tabs">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        if (t.external) {
          if (isElectron()) {
            return (
              <button
                key={t.href}
                type="button"
                className={`topbar-link${active ? " active" : ""}`}
                onClick={() => (window.__KARATE__ as { openPublicWindow?: () => void })?.openPublicWindow?.()}
              >
                {t.label}
              </button>
            );
          }
          return (
            <a
              key={t.href}
              href={t.href}
              target="_blank"
              rel="noopener"
              className={active ? "active" : ""}
            >
              {t.label}
            </a>
          );
        }
        return (
          <Link
            key={t.href}
            href={t.href}
            className={active ? "active" : ""}
          >
            {t.label}
          </Link>
        );
      })}
      <span className="brand">KARATE TOURNAMENT</span>
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 12, alignItems: "center" }}>
        <NetworkStatusBadge variant="inline" />
        {!isKiosk ? (
          <button
            type="button"
            className="topbar-link"
            onClick={() => router.push("/area-select")}
            title="Choose a different competition area"
          >
            ← Change Area
          </button>
        ) : null}
        {!isElectron() && downloads?.mac && (
          <button
            type="button"
            className="topbar-link topbar-download"
            onClick={handleDownloadApp}
            disabled={downloading}
            title="Download the desktop app with your current session"
          >
            {downloading ? "Preparing…" : "↓ Download App"}
          </button>
        )}
        {!isKiosk && (
          <button type="button" className="topbar-link" onClick={logout}>
            Sign out
          </button>
        )}
      </span>
    </nav>
  );
}
