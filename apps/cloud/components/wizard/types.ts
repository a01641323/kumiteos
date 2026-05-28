// Shared types for the request wizard. Matches the bundle shape
// expected by the local applier (apps/local/src/network/actions.ts
// REPLACE_TOURNAMENT_BUNDLE handler) so the round-trip is loss-free.

export type BeltColor =
  | "white" | "yellow" | "orange" | "green"
  | "blue" | "purple" | "brown" | "black";

export const BELT_ORDER: BeltColor[] = [
  "white", "yellow", "orange", "green", "blue", "purple", "brown", "black",
];

export const BELT_LABEL: Record<BeltColor, string> = {
  white: "Blanco", yellow: "Amarillo", orange: "Naranja", green: "Verde",
  blue: "Azul", purple: "Morado", brown: "Marrón", black: "Negro",
};

/** Feminine singular forms used to auto-name categories ("Amarilla 4-6"). */
export const BELT_LABEL_F: Record<BeltColor, string> = {
  white: "Blanca", yellow: "Amarilla", orange: "Naranja", green: "Verde",
  blue: "Azul", purple: "Morada", brown: "Marrón", black: "Negra",
};

/** Derive a display name from belts + age range. */
export function deriveCategoryName(belts: BeltColor[], minAge: number, maxAge: number | null): string {
  let beltPart: string;
  if (belts.length === BELT_ORDER.length) beltPart = "Todas";
  else if (belts.length === 0) beltPart = "Sin cintas";
  else if (belts.length === 1) beltPart = BELT_LABEL_F[belts[0]];
  else if (belts.length === 2) beltPart = `${BELT_LABEL_F[belts[0]]}/${BELT_LABEL_F[belts[1]]}`;
  else beltPart = "Mixto";
  const agePart = maxAge ? `${minAge}-${maxAge}` : `${minAge}+`;
  return `${beltPart} ${agePart}`;
}

export const BELT_ALIASES: Record<string, BeltColor> = {
  white: "white", blanco: "white", blanca: "white",
  yellow: "yellow", amarillo: "yellow", amarilla: "yellow",
  orange: "orange", naranja: "orange",
  green: "green", verde: "green",
  blue: "blue", azul: "blue",
  purple: "purple", morado: "purple", morada: "purple", violeta: "purple",
  brown: "brown", marron: "brown", "marrón": "brown", cafe: "brown", "café": "brown",
  black: "black", negro: "black", negra: "black",
};

export interface CategoryDef {
  id: string;
  name: string;
  belts: BeltColor[];
  minAge: number;
  maxAge: number | null;
  /** Combat match duration in seconds (default 120 = 2:00 when unset). */
  matchDurationSeconds?: number;
}

export interface ParticipantRow {
  /** Full display name — first + last go here together. */
  nombre: string;
  /**
   * Original "apellido" slot kept empty so the local app's existing
   * Participant.apellido type stays a string. The wizard never
   * collects a separate last name; it lives inside `nombre`.
   */
  apellido: string;
  /**
   * Club / dojo the competitor represents. Stored in the bundle so
   * future scoreboard/bracket revisions can surface it. Today no
   * downstream UI displays it — it's collected purely as data.
   */
  dojo: string;
  beltColor: BeltColor;
  age: number;
  arrived?: boolean;
}

export interface BundleSettings {
  subcategorySize: number;
  disciplineMode: "combat" | "kata" | "both";
  areaCount: number;
  pointDifference?: number;
}

export interface WizardBundle {
  bundleVersion: 1;
  label?: string;
  preparedAt?: string;
  categoryDefs: CategoryDef[];
  participants: ParticipantRow[];
  settings: BundleSettings;
  logoDataUrl: string | null;
}

export interface WizardContact {
  email: string;
  org: string;
  tournamentDate: string;
  notes: string;
}

/**
 * Freshness of the underlying CodeRecord, only meaningful when
 * `status === "granted"`. The wizard uses this to decide between
 * the active-code view (with install commands) and the expired
 * view (with "Solicitar nuevo código").
 *
 *  - "active":  code.status === "used"   && code.expiresAt > now
 *  - "unused":  code.status === "unused" (admin granted but customer
 *                                         has not activated yet)
 *  - "dead":    revoked, post-48h, or missing row
 */
export type WizardCodeStatus = "active" | "unused" | "dead";

export interface WizardSnapshot {
  requestId: string | null;
  status: "draft" | "pending" | "granted" | "rejected";
  rejectionReason: string | null;
  rawCode: string | null;
  /** Only present when status === "granted". */
  codeStatus?: WizardCodeStatus;
  codeExpiresAt?: number | null;
  contact: WizardContact;
  bundle: WizardBundle;
}

export const STEPS = [
  { key: "contact",       label: "Contacto" },
  { key: "settings",      label: "Ajustes" },
  { key: "logo",          label: "Logo" },
  { key: "categories",    label: "Categorías" },
  { key: "participants",  label: "Competidores" },
  { key: "review",        label: "Revisar" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export function emptyBundle(): WizardBundle {
  return {
    bundleVersion: 1,
    categoryDefs: [],
    participants: [],
    settings: { subcategorySize: 4, disciplineMode: "both", areaCount: 1, pointDifference: 8 },
    logoDataUrl: null,
  };
}

export function emptyContact(): WizardContact {
  return { email: "", org: "", tournamentDate: "", notes: "" };
}
