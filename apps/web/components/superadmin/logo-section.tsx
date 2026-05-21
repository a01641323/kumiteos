"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { useOverlay } from "@/lib/overlay-context";
import {
  apiGetLogoInfo,
  logoSrc,
  type LogoInfo,
} from "@/lib/api-client";
import { adminUploadLogo, adminRemoveLogo } from "@/lib/admin-api-client";

export function LogoSection() {
  const { setLogoUrl } = useStore();
  const { token } = useAuth();
  const { getLocalAdminToken } = useOverlay();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<LogoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiGetLogoInfo(token)
      .then((r) => {
        setLogo(r.logo);
        if (r.logo) setLogoUrl(logoSrc());
      })
      .catch(() => {
        // server unreachable — keep prior logoUrl as cached
      });
  }, [token, setLogoUrl]);

  async function upload(file: File) {
    const adminToken = getLocalAdminToken();
    if (!adminToken) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await adminUploadLogo(adminToken, file) as { logo: LogoInfo | null };
      setLogo(r.logo);
      if (r.logo) setLogoUrl(logoSrc() + "?t=" + Date.now());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const adminToken = getLocalAdminToken();
    if (!adminToken) return;
    if (!window.confirm("Remove the current logo?")) return;
    setBusy(true);
    setErr(null);
    try {
      await adminRemoveLogo(adminToken);
      setLogo(null);
      setLogoUrl(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="super-section">
      <h2>Logo</h2>
      <p className="muted">
        Uploaded once and shown in both the private referee panel and the public
        scoreboard. Max 2 MB. PNG, JPG, or SVG.
      </p>
      <div className="row" style={{ alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 140,
            height: 140,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            borderRadius: 12,
            border: "1px solid var(--border, #2a3142)",
            overflow: "hidden",
          }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc() + "?t=" + (logo.size + (logo.filename.length || 0))}
              alt="Tournament logo"
              style={{ maxWidth: "100%", maxHeight: "100%" }}
            />
          ) : (
            <span className="muted small" style={{ color: "#888" }}>
              No logo
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Working…" : "Upload logo…"}
          </button>
          {logo ? (
            <button onClick={remove} disabled={busy} className="danger">
              Remove
            </button>
          ) : null}
          {err ? <div className="auth-error">{err}</div> : null}
        </div>
      </div>
    </section>
  );
}
