import { oauthConfigured } from "@/auth";
import { listAllCodes } from "@/lib/tokens";
import { getRequest } from "@/lib/requests";
import { getBundleMeta } from "@/lib/bundle";
import { CodesTable } from "./table";

export const dynamic = "force-dynamic";

export default async function CodesPage() {
  if (!oauthConfigured) return null;
  const codes = await listAllCodes();
  // Hydrate one row of context per code so the table can show "who"
  // the code was granted to without doing N round-trips client-side.
  const enriched = await Promise.all(
    codes.map(async (c) => {
      const [req, bundleMeta] = await Promise.all([
        getRequest(c.requestId),
        getBundleMeta(c.codeId).catch(() => null),
      ]);
      return {
        codeId: c.codeId,
        status: c.status,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
        activatedAt: c.activatedAt,
        ttlHours: c.ttlHours,
        machineFingerprint: c.machineFingerprint,
        email: req?.email ?? null,
        org: req?.org ?? null,
        tournamentDate: req?.tournamentDate ?? null,
        bundle: bundleMeta,
      };
    }),
  );

  return (
    <section className="section">
      <div className="section-head">
        <div className="section-num">03</div>
        <div className="section-titles">
          <h2 className="section-title">Códigos emitidos</h2>
          <p className="section-sub">
            Los códigos se vencen automáticamente cuando se acaba la
            ventana. Revocar uno corta la sesión activa al instante.
          </p>
        </div>
        <div className="section-meta">{enriched.length} EN TOTAL</div>
      </div>

      {enriched.length === 0 ? (
        <div className="card empty-card">
          <span className="empty-icon" aria-hidden>○</span>
          <div>
            <div className="empty-title">Sin códigos emitidos</div>
            <div className="empty-sub">Aprobar una solicitud genera el primero.</div>
          </div>
        </div>
      ) : (
        <CodesTable rows={enriched} />
      )}
    </section>
  );
}
