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
}

export interface ParticipantRow {
  nombre: string;
  apellido: string;
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

export interface WizardSnapshot {
  requestId: string | null;
  status: "draft" | "pending" | "granted" | "rejected";
  rejectionReason: string | null;
  rawCode: string | null;
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
