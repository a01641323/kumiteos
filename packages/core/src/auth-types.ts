// Client-facing license types. The server defines the canonical shape; this
// mirrors it so consumers in the web app stay typed without importing the
// server package.

/**
 * Claim-code roles. As of the stealth-chord rewrite all newly-issued claim
 * codes are `referee`-only. `superadmin` is kept on the type so legacy JWTs
 * from prior versions still decode without throwing, but no code path now
 * mints a superadmin token; admin operations are gated by the local
 * elevation token on the desktop client.
 *
 * @deprecated `"superadmin"` — kept for backwards compatibility only.
 */
export type Role = "superadmin" | "referee";

export type Feature =
  | "scoring"
  | "public_display"
  | "bracket_view"
  | "tournament_config"
  | "logo_upload"
  | "user_management"
  | "activity_log";

export interface AuthUser {
  role: Role;
  features: Feature[];
}

// Public license payload that the renderer is allowed to see. The raw JWT,
// master key, machine fingerprint and other secrets stay in the main process.
export interface LicensePublic {
  role: Role;
  features: Feature[];
  plan: string;
  expiresAt: number;
  activatedAt: number;
  jti: string;
}

export type LicenseDegradedReason =
  | "EXPIRED"
  | "REVOKED"
  | "MACHINE_MISMATCH"
  | "CLOCK_TAMPER"
  | "INVALID_SIGNATURE"
  | "STORAGE_CORRUPTED";

export type LicenseState =
  | { kind: "unlicensed" }
  | { kind: "active"; license: LicensePublic }
  | {
      kind: "grace";
      license: LicensePublic;
      graceStartAt: number;
      graceRemainingMs: number;
    }
  | { kind: "degraded"; reason: LicenseDegradedReason; lastRole: Role | null };

// Legacy alias kept so files that haven't migrated still compile while the
// rest of the codebase moves to LicenseState.
export interface AuthSession {
  token: string;
  issuedAt: number;
  expiresAt: number;
  user: AuthUser;
}

export interface KioskSession {
  token: string;
  issuedAt: number;
  expiresAt: number;
  user: AuthUser;
}

// Admin-side license/code record (returned by /api/admin/licenses).
export interface LicenseCodeRecord {
  code: string;          // 6-digit string (only shown on creation)
  codePreview?: string;  // last 2 digits, for listing
  userId: string;
  role: Role;
  features: Feature[];
  label: string;
  createdAt: number;
  expiresAt: number;     // claim-code expiry (separate from JWT exp)
  status: "unused" | "active" | "expired" | "revoked";
  machineFingerprintTail: string | null; // last 8 chars
  activatedAt: number | null;
  jti: string | null;
  lastRenewalAt: number | null;
}

export interface SessionInfo {
  jti: string;
  role: Role;
  issuedAt: number;
  expiresAt: number;
  ip: string | null;
  revoked: boolean;
}
