"use client";

import { useNetworkStatus } from "@/lib/network-context";

interface Props {
  variant?: "inline" | "floating";
}

export function NetworkStatusBadge({ variant = "inline" }: Props) {
  const status = useNetworkStatus();

  let dotColor = "#8892a4";
  let pulse = false;
  let label = "Local";

  if (status.mode === "server") {
    if (status.connected) {
      dotColor = "#4ade80";
      const n = status.clients.length;
      label = n === 1 ? "Server · 1 client" : `Server · ${n} clients`;
    } else {
      dotColor = "#d8a84b";
      pulse = true;
      label = "Server · starting…";
    }
  } else if (status.mode === "client") {
    if (status.connected) {
      dotColor = "#4ade80";
      const host = status.serverInfo?.hostname ?? status.serverInfo?.serverIp ?? "server";
      label = `Client · ${host}`;
    } else {
      dotColor = status.serverInfo ? "#e05252" : "#d8a84b";
      pulse = !status.serverInfo;
      label = status.serverInfo ? "Offline · view only" : "Searching…";
    }
  }

  const base: React.CSSProperties =
    variant === "floating"
      ? {
          position: "fixed",
          right: 12,
          bottom: 12,
          padding: "6px 10px",
          background: "rgba(15,17,23,0.7)",
          borderRadius: 6,
          fontSize: 12,
          color: "#cdd5e0",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          pointerEvents: "none",
          zIndex: 5,
        }
      : {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "#cdd5e0",
        };

  const dot: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: dotColor,
    boxShadow: `0 0 6px ${dotColor}`,
    animation: pulse ? "karate-pulse 1.2s ease-in-out infinite" : "none",
  };

  return (
    <span style={base} aria-live="polite" aria-label={`Network: ${label}`}>
      <span style={dot} aria-hidden />
      <span>{label}</span>
      <style>{`
        @keyframes karate-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </span>
  );
}
