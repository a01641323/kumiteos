import Link from "next/link";
import { notFound } from "next/navigation";
import { oauthConfigured } from "@/auth";
import { getRequest } from "@/lib/requests";
import { getRequestBundle, getRequestBundleMeta, MAX_BUNDLE_BYTES } from "@/lib/bundle";
import { GrantButton, RejectButton } from "../actions-ui";

export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }> }

const BELT_ES: Record<string, string> = {
  white: "Blanco", yellow: "Amarillo", orange: "Naranja", green: "Verde",
  blue: "Azul", purple: "Morado", brown: "Marrón", black: "Negro",
};

export default async function RequestDetailPage({ params }: RouteContext) {
  if (!oauthConfigured) return null;
  const { id } = await params;
  const r = await getRequest(id);
  if (!r) notFound();
  const [bundle, meta] = await Promise.all([
    getRequestBundle(id).catch(() => null),
    getRequestBundleMeta(id).catch(() => null),
  ]);

  return (
    <section className="section">
      <div className="section-head">
        <div className="section-num">02</div>
        <div className="section-titles">
          <h2 className="section-title">{r.email}</h2>
          <p className="section-sub">
            {r.org ? `${r.org} · ` : ""}
            {r.tournamentDate ?? "sin fecha"}
            {" · "}
            estado: <strong>{r.status}</strong>
          </p>
        </div>
        <div className="section-meta">
          <Link href="/admin/requests" className="muted">← solicitudes</Link>
        </div>
      </div>

      {!bundle && (
        <div className="card empty-card" style={{ marginBottom: 16 }}>
          <span className="empty-icon" aria-hidden>?</span>
          <div>
            <div className="empty-title">Sin bundle adjunto</div>
            <div className="empty-sub">
              Esta solicitud fue creada con el flujo anterior. Aprobarla generará un
              código sin configuración pre-cargada.
            </div>
          </div>
        </div>
      )}

      <div className="review-grid">
        {bundle && (
          <>
            <div className="card">
              <div className="card-head"><span className="card-eyebrow">AJUSTES</span></div>
              <div style={{ display: "grid", gap: 6 }}>
                <Row k="Áreas" v={String(bundle.settings.areaCount)} />
                <Row k="Disciplina" v={bundle.settings.disciplineMode} />
                <Row k="Tamaño llave" v={String(bundle.settings.subcategorySize)} />
                <Row k="Diferencia pts" v={String(bundle.settings.pointDifference ?? 0)} />
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span className="card-eyebrow">TOTALES</span></div>
              <div style={{ display: "grid", gap: 6 }}>
                <Row k="Competidores" v={String(bundle.participants.length)} />
                <Row k="Categorías" v={String(bundle.categoryDefs.length)} />
                <Row k="Logo" v={bundle.logoDataUrl ? "✓" : "—"} />
                <Row k="Tamaño" v={`${Math.round((meta?.sizeBytes ?? 0) / 1024)} / ${Math.round(MAX_BUNDLE_BYTES / 1024)} KB`} />
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span className="card-eyebrow">LOGO</span></div>
              {bundle.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bundle.logoDataUrl}
                  alt="logo"
                  style={{ width: 160, height: 160, objectFit: "contain", background: "color-mix(in oklab, var(--color-fg) 4%, transparent)", border: "1px solid var(--color-line)", borderRadius: 4 }}
                />
              ) : <span className="muted">Sin logo</span>}
            </div>

            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <div className="card-head"><span className="card-eyebrow">CATEGORÍAS</span></div>
              {bundle.categoryDefs.length === 0 ? (
                <span className="muted">— ninguna —</span>
              ) : (
                <table className="cat-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Cinturones</th>
                      <th>Edad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bundle.categoryDefs as Array<{ id: string; name: string; belts: string[]; minAge: number; maxAge: number | null }>).map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className="muted small">{c.belts.map((b) => BELT_ES[b] ?? b).join(", ")}</td>
                        <td className="mono small">{c.minAge}{c.maxAge ? `–${c.maxAge}` : "+"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted small" style={{ marginTop: 16 }}>
                Por privacidad, no mostramos los nombres de los competidores — solo el conteo total.
              </p>
            </div>
          </>
        )}

        {r.notes && (
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="card-head"><span className="card-eyebrow">NOTAS DEL CLIENTE</span></div>
            <p style={{ whiteSpace: "pre-wrap" }}>{r.notes}</p>
          </div>
        )}
      </div>

      {r.status === "pending" && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><span className="card-eyebrow">ACCIONES</span></div>
          <div className="row-actions" style={{ display: "flex", gap: 8 }}>
            <GrantButton id={r.id} hasBundle={!!bundle} primary />
            <RejectButton id={r.id} />
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span className="muted small mono" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{k}</span>
      <span className="mono small">{v}</span>
    </div>
  );
}
