"use client";

import { useState, useEffect, useCallback } from "react";
import type { LicenseCodeRecord } from "@karate/core";
import { useOverlay } from "@/lib/overlay-context";
import {
  adminGetLicenses,
  adminCreateLicense,
  adminRevokeLicense,
  adminTransferLicense,
  adminExtendLicense,
  adminGetAppConfig,
  adminUpdateAppConfig,
} from "@/lib/admin-api-client";

export function UsersSection() {
  const { getLocalAdminToken } = useOverlay();
  const [licenses, setLicenses] = useState<LicenseCodeRecord[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newTtl, setNewTtl] = useState("30");
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [ttlMinutes, setTtlMinutes] = useState("480");
  const [savingTtl, setSavingTtl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = getLocalAdminToken();
    if (!token) return;
    setLoading(true);
    try {
      const [list, cfg] = await Promise.all([
        adminGetLicenses(token),
        adminGetAppConfig(token),
      ]);
      setLicenses(list.licenses);
      setTtlMinutes(String(cfg.sessionTtlMinutes));
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch_failed");
    } finally { setLoading(false); }
  }, [getLocalAdminToken]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleCreate() {
    const token = getLocalAdminToken();
    if (!token) return;
    if (!newLabel.trim()) { setError("Label is required."); return; }
    setError(null);
    setGenerating(true);
    try {
      const r = await adminCreateLicense(token, {
        label: newLabel.trim(),
        ttlMinutes: parseInt(newTtl, 10) || 43200,
      });
      setLastCode(r.code);
      setNewLabel("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create_failed");
    } finally { setGenerating(false); }
  }

  async function handleRevoke(userId: string) {
    const token = getLocalAdminToken();
    if (!token) return;
    if (!confirm("Revoke this license? The registered device will lose access on next renewal.")) return;
    try { await adminRevokeLicense(token, userId); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "revoke_failed"); }
  }

  async function handleTransfer(userId: string) {
    const token = getLocalAdminToken();
    if (!token) return;
    if (!confirm("Reset the machine fingerprint? The original code becomes reclaimable on a new device.")) return;
    try { await adminTransferLicense(token, userId); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "transfer_failed"); }
  }

  async function handleExtend(userId: string) {
    const token = getLocalAdminToken();
    if (!token) return;
    const days = parseInt(prompt("Extend by how many days?", "30") || "0", 10);
    if (!days || days < 1) return;
    try { await adminExtendLicense(token, userId, days); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "extend_failed"); }
  }

  async function handleSaveTtl() {
    const token = getLocalAdminToken();
    if (!token) return;
    const v = parseInt(ttlMinutes, 10);
    if (!v || v < 1) return;
    setSavingTtl(true);
    try { await adminUpdateAppConfig(token, v); } finally { setSavingTtl(false); }
  }

  return (
    <section className="super-section">
      <h2 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        Licenses
        <button onClick={refresh} disabled={loading} style={{ fontSize: 13 }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </h2>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", background: "var(--panel-2, #1d2230)", borderRadius: 8 }}>
        <span style={{ fontSize: 13, color: "var(--muted, #8892a4)" }}>Kiosk session TTL:</span>
        <input type="number" min={1} value={ttlMinutes} onChange={(e) => setTtlMinutes(e.target.value)} style={{ width: 80 }} />
        <span style={{ fontSize: 13, color: "var(--muted, #8892a4)" }}>minutes</span>
        <button className="primary" style={{ fontSize: 12 }} disabled={savingTtl} onClick={handleSaveTtl}>
          {savingTtl ? "Saving…" : "Save"}
        </button>
      </div>

      <div style={{ padding: 14, background: "var(--panel-2, #1d2230)", borderRadius: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Generate claim code</div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <input
            placeholder="Label (e.g. Club Guadalajara – Area 1)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <input
            type="number"
            min={1}
            value={newTtl}
            onChange={(e) => setNewTtl(e.target.value)}
            style={{ width: 70 }}
            title="Days until the code expires if unused"
          />
          <span style={{ fontSize: 12, color: "var(--muted, #8892a4)" }}>days</span>
          <button className="primary" disabled={generating} onClick={handleCreate}>
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
        {lastCode && (
          <div style={{ marginTop: 12, padding: 12, background: "#0f1117", borderRadius: 6, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--muted, #8892a4)", marginBottom: 6 }}>New code (shown once)</div>
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 28, letterSpacing: 10, fontWeight: 700 }}>
              {lastCode}
            </div>
            <button style={{ marginTop: 10, fontSize: 12 }} onClick={() => setLastCode(null)}>Dismiss</button>
          </div>
        )}
      </div>

      {error && <div style={{ color: "var(--red, #e05252)", marginBottom: 10 }}>{error}</div>}

      {licenses.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No licenses yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border, #2a3142)" }}>
              <th style={th}>Label</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}>Expires</th>
              <th style={th}>Machine</th>
              <th style={th}>Last renewal</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((l) => (
              <tr key={l.userId} style={{ borderBottom: "1px solid var(--border, #2a3142)" }}>
                <td style={td}>{l.label}</td>
                <td style={td}>{l.role}</td>
                <td style={td}>
                  <span style={{
                    fontSize: 11, padding: "2px 7px", borderRadius: 4,
                    color: l.status === "active" ? "#4ade80"
                         : l.status === "revoked" ? "#e25c5c"
                         : l.status === "expired" ? "#d8a84b"
                         : "#8892a4",
                    background: l.status === "active" ? "rgba(74,222,128,0.12)"
                              : l.status === "revoked" ? "rgba(226,92,92,0.12)"
                              : l.status === "expired" ? "rgba(216,168,75,0.12)"
                              : "rgba(136,146,164,0.12)",
                  }}>{l.status}</span>
                </td>
                <td style={td}>{new Date(l.expiresAt).toLocaleDateString()}</td>
                <td style={td} className="muted">{l.machineFingerprintTail ?? "—"}</td>
                <td style={td} className="muted">{l.lastRenewalAt ? new Date(l.lastRenewalAt).toLocaleString() : "—"}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {l.status !== "revoked" && (
                      <button onClick={() => handleRevoke(l.userId)} style={dangerBtn}>Revoke</button>
                    )}
                    {l.status === "active" && (
                      <button onClick={() => handleTransfer(l.userId)} style={subtleBtn}>Transfer</button>
                    )}
                    {l.status === "unused" && (
                      <button onClick={() => handleExtend(l.userId)} style={subtleBtn}>Extend</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", color: "var(--muted, #8892a4)", fontWeight: 500, fontSize: 12 };
const td: React.CSSProperties = { padding: "8px 8px", verticalAlign: "middle" };
const dangerBtn: React.CSSProperties = { fontSize: 10, padding: "1px 6px", color: "var(--red, #e05252)", background: "none", border: "1px solid var(--red, #e05252)", borderRadius: 3, cursor: "pointer" };
const subtleBtn: React.CSSProperties = { fontSize: 10, padding: "1px 6px", color: "var(--muted, #8892a4)", background: "none", border: "1px solid var(--border, #2a3142)", borderRadius: 3, cursor: "pointer" };
