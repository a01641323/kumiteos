"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { Scoreboard } from "@/components/scoreboard";
import { NetworkStatusBadge } from "@/components/network-status-badge";

function toggleFullscreen() {
  const fs =
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement;
  if (!fs) {
    const root = document.documentElement;
    (root.requestFullscreen ||
      (root as any).webkitRequestFullscreen)?.call(root);
  } else {
    (document.exitFullscreen ||
      (document as any).webkitExitFullscreen)?.call(document);
  }
}

export default function PublicPage() {
  const { state } = useStore();
  const cursorTimer = useRef<number | null>(null);

  useEffect(() => {
    const onFs = () => {
      document.body.classList.toggle(
        "fs-active",
        !!document.fullscreenElement
      );
    };
    document.addEventListener("fullscreenchange", onFs);
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    const onMove = () => {
      document.body.classList.add("show-cursor");
      if (cursorTimer.current) window.clearTimeout(cursorTimer.current);
      cursorTimer.current = window.setTimeout(
        () => document.body.classList.remove("show-cursor"),
        1500
      );
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <section id="view-public">
      <Scoreboard state={state} variant="public" />
      <div className="fs-hint">Press F for fullscreen</div>
      <NetworkStatusBadge variant="floating" />
    </section>
  );
}
