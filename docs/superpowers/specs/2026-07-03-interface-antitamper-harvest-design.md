# Harvest the `interface` template — offline anti-tamper enforcement

## Context

A folder `interface/` (the self-contained **openinterface-template**) was added to the
Kumite/OS monorepo. The ask: adopt its "interface-managing system" (code administration,
offline timeout, LAN connectivity, self-update) — *"even if we already built it, this should be
better"* — while keeping our existing, richer **design and options** (*"it has less options than
we have and practically zero design… it's just a template"*).

Exploring both sides changed the picture. The shipping app (v0.2.6) is **already more capable
than the template in three of the four subsystems**. The template is genuinely superior in
**exactly one**: offline timeout / clock-tamper enforcement — and there our app has the
`CLOCK_TAMPER` reason *declared but never actually detected* (`packages/core/src/auth-types.ts:45`;
no monotonic-budget / high-water / sealed-store logic exists anywhere in the codebase).

User-confirmed decisions:

- **Core intent**: adopt the template's *mechanisms* incrementally — keep the existing
  `apps/cloud` / `apps/local` / `apps/web` architecture; upgrade plumbing where genuinely better.
- **Treatment of the three subsystems we already lead**: **"Harvest, don't regress."** Cherry-pick
  only genuinely superior patterns; never drop an existing capability, option, or design element.
- **Net outcome**: finally implement real offline clock-tamper defense on the host license,
  closing the "roll the clock back to extend the 48h offline grace" hole — zero regression.

## Scope summary (per subsystem)

| Subsystem | Action | Why |
|---|---|---|
| **Offline timeout / anti-tamper** | **Full port** into `apps/local` | Template's `clock-guard` + `sealed-store` is the one real upgrade; our `CLOCK_TAMPER` is currently a no-op. |
| **LAN connectivity + realtime** | **Harvest one pattern**: single enforcement exit that force-drops *all* (incl. already-approved) LAN clients on session end | Needed so the anti-tamper exit propagates; existing WS is otherwise richer, left intact. |
| **Code administration** | **No change** (reviewed) | Existing (GitHub-OAuth admin, KV, grant/reject/revoke/purge/transfer, rental lineage, machine binding, per-code bundles) strictly exceeds the template. |
| **Self-update + installer** | **No change** (reviewed) | Existing `kumiteos update` (installer re-run, PID-stop, port-free wait, GH-releases matrix) is more robust than the template's bundle-swap. |

## Design — offline anti-tamper core (ported from the template)

**Where it lives.** The long-running `apps/local` host server becomes the authority on the host
license's *offline window*. It has a true monotonic clock (`process.hrtime.bigint()`) and can
hold a per-install HMAC secret the browser never sees — neither is reliable in the browser. The
browser stays the UI and reflects the server's verdict, rather than trusting its own `Date.now()`.

**Two new modules in `apps/local/src/` (TS ports of the template):**

- `sealed-session.ts` ← port of `interface/cli/lib/sealed-store.mjs`
  - `seal/unseal` (HMAC-SHA256 + `timingSafeEqual`), `loadInstallKey(dataDir)` (32 random bytes,
    mode `0o600`, self-healing), `readState/writeState/deleteState`. Integrity failure deletes the
    file on sight.
  - Reuse `ensureDir` from `apps/local/src/storage.ts`. Store `install-key` + `session.json` under
    the existing `dataDir/keys/` (alongside `keys.ts`'s Ed25519 material).
- `session-guard.ts` ← port of `interface/cli/lib/clock-guard.mjs`
  - `evaluateSession(payload, state, now)` → `active | expired | budget-exhausted | tampered`,
    `CLOCK_GRACE_MS = 90_000`, `TICK_MS = 5_000`.
  - Sealed state `{ jti, issuedAt, expiresAt, highWater, budgetUsedMs }`. A 5s tick accumulates
    monotonic budget, advances `highWater`, re-evaluates, persists (sealed).
  - `issuedAt/expiresAt` come from the **verified** license JWT (`iat`/`exp`, or the activation
    record window) — unforgeable; only *time* is defended here.

**Wiring (existing seams, no new architecture):**

1. **Record on activation.** `apps/local/src/routes.ts` `/api/activate` success paths
   (cloud-proxy ~L145, local-mode ~L245) and/or first authenticated bootstrap in `requireAuth` —
   write the sealed session for the presented `jti`/window (idempotent refresh).
2. **Enforce.** `apps/local/src/auth.ts` `requireAuth` consults the guard alongside the existing
   JWT + `isRevoked` + `expiresAt` checks: `tampered → CLOCK_TAMPER`,
   `expired/budget-exhausted → EXPIRED`.
3. **Tick + enforcement exit.** A 5s interval started in `createServer`/`standalone.ts`. On a
   failing verdict: `deleteState`, flip host-locked, and call the controller's `disconnectAll()`.
   Feed the guard verdict into the controller's existing `isHostLicensed` hook
   (`apps/local/src/network/controller.ts:30`).
4. **Surface to browser.** Extend the status/SSE payload (or a small `GET /api/session/status`)
   with the degraded reason; `apps/web/lib/auth-context.tsx` locks on it. `CLOCK_TAMPER` already
   exists in `LicenseDegradedReason`; map budget-exhaustion to `EXPIRED` (optionally add
   `BUDGET_EXHAUSTED`).

**Realtime harvest.** Ensure the enforcement exit force-drops **already-approved** referees/guests,
not just the pending queue — mirroring the template's `sessionEnded` broadcast
(`interface/cli/lib/realtime.mjs:81`). Reuse `disconnectAll()` +
`MSG.CONNECTION_REJECTED` (`reason: "host_unlicensed"`) in `apps/local/src/network/ws-server.ts`;
add a `SESSION_LOCKED` broadcast only if approved clients don't already flip to locked.

## Files

**New:** `apps/local/src/sealed-session.ts`, `apps/local/src/session-guard.ts`, and tests
`apps/local/src/session-guard.test.ts`, `apps/local/src/sealed-session.test.ts` (port
`interface/app/tests/cli-clock-guard.test.ts` + `cli-sealed-store.test.ts`).

**Modified:** `apps/local/src/auth.ts`, `apps/local/src/routes.ts`,
`apps/local/src/standalone.ts` (or `index.ts`), `apps/local/src/network/controller.ts`,
`apps/local/src/network/ws-server.ts`, `apps/web/lib/auth-context.tsx`; possibly
`packages/core/src/auth-types.ts` (optional `BUDGET_EXHAUSTED`).

**Reused, unchanged:** `apps/local/src/storage.ts` (`ensureDir`), `apps/local/src/keys.ts`
(key-dir convention), existing `LicenseStore`, WS protocol.

## Verification (end-to-end)

- **Unit:** ported guard/sealed-store tests pass (roll-back → `tampered`; wall-freeze until budget
  hits the window → `budget-exhausted`; hand-edit any byte of `session.json` → unseal fails → file
  deleted → locked).
- **Integration (manual, per `interface/docs/E2E-CHECKLIST.md`):** activate on the host; take it
  offline; (a) roll the clock back >90s → host locks with `CLOCK_TAMPER` and a connected LAN referee
  is force-dropped; (b) freeze the clock → access ends when accumulated runtime reaches the granted
  window even though the wall clock still shows time left; (c) hand-edit
  `dataDir/keys/session.json` → locked on next tick; (d) valid restart → budget accumulates
  monotonically, session survives.
- **Regression:** normal online activation, 5-min JTI heartbeat, 48h grace, guest approval,
  scoreboard sync, and `kumiteos update` unchanged (build clean: core typecheck, web build, cloud
  build, local typecheck).
