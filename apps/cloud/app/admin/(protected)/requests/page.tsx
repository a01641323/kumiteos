import Link from "next/link";
import { oauthConfigured } from "@/auth";
import { listPending } from "@/lib/requests";
import { getRequestBundleMeta } from "@/lib/bundle";
import { GrantButton, RejectButton } from "./actions-ui";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  if (!oauthConfigured) return null;
  const pending = await listPending();
  const enriched = await Promise.all(
    pending.map(async (r) => ({
      r,
      bundle: await getRequestBundleMeta(r.id).catch(() => null),
    })),
  );

  return (
    <section className="section">
      <div className="section-head">
        <div className="section-num">02</div>
        <div className="section-titles">
          <h2 className="section-title">Solicitudes pendientes</h2>
          <p className="section-sub">
            Cada solicitud trae el bundle del torneo armado por el cliente.
            Aprobarla genera el código de 6 dígitos y entrega el bundle.
          </p>
        </div>
        <div className="section-meta">{enriched.length} EN COLA</div>
      </div>

      {enriched.length === 0 ? (
        <div className="card empty-card">
          <span className="empty-icon" aria-hidden>✓</span>
          <div>
            <div className="empty-title">No hay solicitudes pendientes</div>
            <div className="empty-sub">Las nuevas solicitudes aparecerán aquí.</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Logo</th>
                <th>Solicitante</th>
                <th>Resumen</th>
                <th>Solicitado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map(({ r, bundle }) => {
                const totals = bundle
                  ? `${bundle.participantCount} comp · ${bundle.categoryCount} cat · ${Math.round(bundle.sizeBytes / 1024)} KB`
                  : "— sin bundle (legacy) —";
                return (
                  <tr key={r.id}>
                    <td style={{ width: 56 }}>
                      {bundle?.hasLogo ? (
                        <LogoThumb requestId={r.id} />
                      ) : (
                        <div style={{ width: 40, height: 40, background: "color-mix(in oklab, var(--color-fg) 6%, transparent)", border: "1px solid var(--color-line)", borderRadius: 4 }} />
                      )}
                    </td>
                    <td>
                      <div>{r.email}</div>
                      <div className="muted small">
                        {r.org ?? "sin organización"}
                        {r.tournamentDate ? ` · ${r.tournamentDate}` : ""}
                      </div>
                    </td>
                    <td className="muted small mono">{totals}</td>
                    <td className="muted small">{new Date(r.submittedAt ?? r.createdAt).toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="row-actions" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <Link className="btn-row" href={`/admin/requests/${r.id}`}>Revisar</Link>
                        <GrantButton id={r.id} hasBundle={!!bundle} />
                        <RejectButton id={r.id} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Small server component that fetches the logo data URL inline.
// Cheap because the bundle is already cached by the surrounding
// page fetch; one extra KV read is acceptable here.
async function LogoThumb({ requestId }: { requestId: string }) {
  const { getRequestBundle } = await import("@/lib/bundle");
  const bundle = await getRequestBundle(requestId).catch(() => null);
  const url = bundle?.logoDataUrl;
  if (!url) {
    return <div style={{ width: 40, height: 40, background: "color-mix(in oklab, var(--color-fg) 6%, transparent)", border: "1px solid var(--color-line)", borderRadius: 4 }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={{ width: 40, height: 40, objectFit: "contain", background: "color-mix(in oklab, var(--color-fg) 6%, transparent)", border: "1px solid var(--color-line)", borderRadius: 4 }} />
  );
}
