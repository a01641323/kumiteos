"use client";

/**
 * AuthGate sits between the layout's providers and the page content. It:
 *
 *   - Shows the activation screen in UNLICENSED state.
 *   - Shows the lock screen in DEGRADED state with the specific reason.
 *   - Renders content + non-dismissable grace banner in GRACE state.
 *   - Enforces optional role gating for ACTIVE state.
 *   - For the public scoreboard route: in ACTIVE / GRACE it allows anonymous
 *     access; in DEGRADED / UNLICENSED the public window is fully hidden
 *     (no scoreboard, no competitor data, per Part 11 of the spec).
 */

import type { LicenseDegradedReason, Role } from "@karate/core";
import { useAuth } from "@/lib/auth-context";
import { LoginScreen } from "./login-screen";
import { LockScreen } from "./lock-screen";
import { GraceBanner } from "./grace-banner";

interface Props {
  children: React.ReactNode;
  /** When provided, page is gated to these roles only. */
  roles?: Role[];
  /** When true, renders children without a license requirement (audience-only
   *  views). Only honored in ACTIVE / GRACE — never in DEGRADED. */
  allowAnonymous?: boolean;
  /** When true, this route IS the public scoreboard and must be hidden when
   *  the license is degraded or absent. */
  isPublicView?: boolean;
}

export function AuthGate({ children, roles, allowAnonymous, isPublicView }: Props) {
  const { status, hasRole } = useAuth();

  if (status.kind === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-loading">Loading…</div>
      </div>
    );
  }

  if (status.kind === "anonymous") {
    if (isPublicView) {
      return (
        <div className="auth-screen">
          <div className="auth-card auth-locked">
            <h1>Display Unavailable</h1>
            <p>The scoreboard is offline.</p>
          </div>
        </div>
      );
    }
    if (allowAnonymous) return <>{children}</>;
    return <LoginScreen />;
  }

  if (status.kind === "locked") {
    if (isPublicView) {
      return (
        <div className="auth-screen">
          <div className="auth-card auth-locked">
            <h1>Display Unavailable</h1>
            <p>The scoreboard is offline.</p>
          </div>
        </div>
      );
    }
    return <LockScreen reason={status.reason as LicenseDegradedReason} />;
  }

  // Guest mode — device joined a host on the LAN; the host's license
  // covers this session. Render children directly (no grace banner, no
  // license-derived role gating).
  if (status.kind === "guest") {
    if (roles && !hasRole(roles)) {
      return (
        <div className="auth-screen">
          <div className="auth-card auth-locked">
            <h1>Restricted</h1>
            <p>This area is only available to {roles.join(" / ")}.</p>
          </div>
        </div>
      );
    }
    return <>{children}</>;
  }

  if (roles && !hasRole(roles)) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-locked">
          <h1>Restricted</h1>
          <p>This area is only available to {roles.join(" / ")}.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <GraceBanner />
      {children}
    </>
  );
}
