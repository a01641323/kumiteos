# Pre-loaded tournament bundle (admin-prepared, code-attached)

## Context

Today the customer activates the binary with their 6-digit code and
lands on an **empty** tournament — no participants, no categories, no
logo, default settings. The customer has to build everything themselves
(CSV import, category editor, logo upload) or call the admin for on-site
configuration.

The admin wants the opposite: prepare every tournament's data ahead of
time, ship that data alongside the access code, and the customer's only
job is paste the code → score matches. The customer must not be able to
alter configuration on their own (in practice this is already true —
the config UI lives behind a superadmin terminal chord, so this design
adds no new lock UI).

User-confirmed decisions:

- **Bundle preparation**: admin builds the tournament on their own dev
  binary, runs a new `export-bundle` command in the superadmin terminal,
  gets a JSON file to upload to `/admin`.
- **Lock**: no new UI. Existing superadmin chord is the only gate the
  customer doesn't know about.
- **Bundle lifetime**: attach at grant time, replaceable until first
  activation, one-shot delivery (deleted from KV on activation).
- **Storage**: Vercel KV inline (bundle ~50–300 KB including base64
  logo) — fits free tier; ~600 KB hard cap.
- **Backward compatible**: codes granted without a bundle work exactly
  like today.

## Bundle shape

Single JSON file. Versioned envelope so future bundles can be upgraded
by the local applier.

```json
{
  "bundleVersion": 1,
  "label": "Liga Yucatán · Mayo",
  "preparedAt": "2026-05-23T15:00:00Z",
  "categoryDefs": [/* CategoryDef[] */],
  "participants": [/* Participant[] without id */],
  "settings": {
    "subcategorySize": 4,
    "disciplineMode": "both",
    "areaCount": 2,
    "pointDifference": 8
  },
  "logoDataUrl": "data:image/png;base64,…" | null
}
```

## Critical files

### New
- `apps/cloud/lib/bundle.ts` — `validateBundle`, `storeBundle`,
  `getBundle`, `deleteBundle`. KV key `bundle:byCodeId:<codeId>`.
- `apps/cloud/app/api/admin/codes/[codeId]/bundle/route.ts` — `GET`
  metadata + `PUT` replace. PUT rejects with 409 if code status is not
  `"unused"`.

### Modified
- `apps/cloud/app/api/admin/requests/[id]/grant/route.ts` — accept an
  optional `bundle` field in the request body; validate; call
  `storeBundle(codeId, bundle)` after `mintCode`.
- `apps/cloud/app/admin/(protected)/requests/actions-ui.tsx` —
  `GrantButton` becomes a two-step: click → file input → parse →
  POST with bundle. Pure-grant path (no file) still works.
- `apps/cloud/app/admin/(protected)/codes/page.tsx` +
  `apps/cloud/app/admin/(protected)/codes/table.tsx` — new column
  "bundle" with a `[Reemplazar]` button for `unused` codes;
  "— none —" otherwise.
- `apps/cloud/app/api/activate/route.ts` — after `markActivated`, look
  up `getBundle(codeId)`. If present, include it in the JSON response
  and `deleteBundle(codeId)`. One-shot delivery.
- `apps/web/components/superadmin-terminal.tsx` — new command
  `export-bundle [label]`. Reads `state.tournament`, base64-inlines
  the logo from `state.tournament.meta.logoUrl`, triggers a download.
- `apps/web/lib/auth-context.tsx` — after `/api/activate` returns, if
  the response has a `bundle` field dispatch
  `REPLACE_TOURNAMENT_BUNDLE { bundle }` before letting the UI render.
- `apps/local/src/network/actions.ts` — new handler
  `REPLACE_TOURNAMENT_BUNDLE`: writes bundle fields into
  `state.tournament`, calls `rebuildAllSubcategories(state)`, then
  `buildAreaPlan(state)` so brackets + area assignments derive from
  the seeded participants.
- `apps/web/lib/store-actions.ts` — envelope builder
  `replaceTournamentBundle(bundle)`.

### Unchanged (deliberately)
- Activation auth chain (JWT verify, machine fingerprint binding).
- Existing CSV import + tournament settings UI in the superadmin
  terminal — kept so the admin can build the bundle locally.
- LAN guest path — guests sync `state.tournament` from the host via WS;
  bundle delivery affects the host only.

## Implementation order

Three commits, each independently testable.

### A. Cloud side: storage + admin upload
1. Write `apps/cloud/lib/bundle.ts` (validation, store/get/delete).
2. Modify the grant route to accept and persist a bundle.
3. Update `GrantButton` to an optional-file-picker.
4. Smoke: grant a request twice (with and without bundle); verify KV
   has the entry only when expected.

### B. Cloud side: replace + activate delivery
1. Add `/api/admin/codes/[codeId]/bundle` (GET + PUT). PUT enforces
   `status === "unused"`.
2. Add a "bundle" column + Reemplazar button to `codes/table.tsx`.
3. Modify `/api/activate` to include `bundle` in the response and
   delete on success.
4. Smoke: replace before activation works; replace after activation
   returns 409.

### C. Local side: export + apply
1. Add `export-bundle` command to the superadmin terminal.
2. Add `REPLACE_TOURNAMENT_BUNDLE` handler + envelope builder.
3. Wire `auth-context.tsx` to dispatch on activation if `bundle`
   present.
4. Smoke: export → upload via /admin → activate on a clean binary →
   tournament fully configured without further input.

## Verification (end-to-end)

1. **Export**: admin terminal `export-bundle "test"` →
   `tournament-test.json` lands in Downloads. Inspect: contains
   `bundleVersion: 1`, `participants`, `categoryDefs`, `settings`,
   `logoDataUrl`.
2. **Upload at grant**: `/admin/requests`, click *Aprobar y enviar
   bundle*, pick the JSON. Confirm KV entry exists; pending request
   gone; client sees the 6-digit code on `/pending/<id>`.
3. **Replace before activation**: `/admin/codes`, click *Reemplazar*
   on the `unused` code; pick a different JSON; confirm KV updated.
4. **Replace after activation rejected**: activate the code from a
   clean binary first. Then try *Reemplazar*: expect 409 and a
   "ya activado" inline message.
5. **Fresh customer e2e**: on a Mac with `~/.kumiteos/data` wiped,
   `curl ... install.sh | sh`; paste a code that has a bundle. Binary
   boots into a fully-configured tournament (categories, participants,
   areas, logo).
6. **Backward compat**: grant a code without a bundle; activate;
   binary boots empty exactly like today.
7. **One-shot delivery**: re-activate the same code on the same
   machine; second response has no `bundle`; state preserved.

## Out of scope

- Live mid-tournament bundle updates (push-after-activation).
- Encryption of bundles at rest in KV.
- Vercel Blob for logos (inline base64 stays cheap at expected volume).
- Server-side semantic validation beyond shape (bracket sanity, name
  uniqueness, etc.).
- Multi-tournament per code (one bundle = one tournament).
- Bundle upload audit log (the `/admin/codes` listing suffices for v1).
