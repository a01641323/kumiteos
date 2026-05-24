// /request — top of the tournament-builder wizard.
//
// Reads the karate.request cookie server-side. If it carries a valid
// access token for an existing request, we hydrate the wizard from
// the stored draft (so the user can keep editing where they left off
// in any tab). Otherwise the wizard starts blank at step 1.

import { cookies } from "next/headers";
import { authorizeAccess } from "@/lib/requests";
import { getRequestBundle } from "@/lib/bundle";
import { decodeRequestCookie, REQUEST_COOKIE } from "@/lib/cookie";
import { Wizard } from "@/components/wizard/Wizard";
import type { WizardSnapshot } from "@/components/wizard/types";
import { emptyBundle, emptyContact } from "@/components/wizard/types";

export const dynamic = "force-dynamic";

async function hydrate(): Promise<WizardSnapshot | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(REQUEST_COOKIE.name)?.value;
  const decoded = decodeRequestCookie(raw);
  if (!decoded) return null;
  const record = await authorizeAccess(decoded.requestId, decoded.accessToken);
  if (!record) return null;
  const bundle = (await getRequestBundle(record.id)) ?? emptyBundle();
  return {
    requestId: record.id,
    status: record.status,
    rejectionReason: record.rejectionReason ?? null,
    rawCode: record.status === "granted" ? record.rawCode : null,
    contact: {
      email: record.email,
      org: record.org ?? "",
      tournamentDate: record.tournamentDate ?? "",
      notes: record.notes ?? "",
    },
    bundle: {
      ...emptyBundle(),
      ...(bundle as object),
      bundleVersion: 1,
      settings: { ...emptyBundle().settings, ...((bundle as { settings?: object }).settings ?? {}) },
    } as WizardSnapshot["bundle"],
  };
}

export default async function RequestPage() {
  const initial = await hydrate().catch(() => null);
  return <Wizard initial={initial ?? { requestId: null, status: "draft", rejectionReason: null, rawCode: null, contact: emptyContact(), bundle: emptyBundle() }} />;
}
