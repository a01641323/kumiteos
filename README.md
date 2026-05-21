# Karate Tournament

A web-based, role-aware karate tournament scoring system. Runs as a Next.js
frontend served by a Node.js (Express + JWT) backend over plain HTTP +
WebSocket on `localhost`. Open it in any modern browser; no installation
required on client machines.

## Layout

```
karate/
├── apps/
│   ├── web/      Next.js 15 (App Router) + Tailwind — statically exported to apps/web/out
│   ├── local/    Express + JWT + WebSocket + tournament state engine (downloadable binary)
│   └── cloud/    Next.js app deployed on Vercel — token requests, admin panel, /api/activate (issues JWTs)
├── packages/
│   └── core/     Pure tournament/engine logic + types (TypeScript)
├── legacy/       Original single-file prototype (preserved for reference)
└── mock-participants.csv
```

## Installation

```bash
pnpm install
pnpm build
```

The build produces a static frontend at `apps/web/out/` and a compiled
server at `apps/local/dist/`.

## Starting the server

For a tournament you've already paid / requested a code for, point the
local app at the cloud so it can redeem the code:

```bash
cd apps/local
KARATE_CLOUD_URL=https://kumiteos.vercel.app pnpm start
```

Then open **<http://localhost:4747>** in your browser. The lock screen
appears — paste the 6-digit code you got from
`https://kumiteos.vercel.app/request` and the app unlocks for 24 hours.

If you want to run fully offline against a locally-issued claim code
(developer mode, no cloud activation), drop the env var:

```bash
pnpm start
```

Either way the server binds to `0.0.0.0:4747` and prints its reachable
URLs on boot:

```
[karate-local] verifying JWTs with cloud public key from https://kumiteos.vercel.app
[karate-server] listening on http://0.0.0.0:4747
[karate-server] open on this machine:  http://localhost:4747
[karate-server] open on the LAN:       http://192.168.1.42:4747
[karate-server] admin panel:           http://localhost:4747/admin-panel
```

### Accessing from other LAN machines

Any machine on the same network can open the app at
`http://<server-machine-IP>:4747`. The server prints its LAN IPs on startup,
and the same list is available at `http://localhost:4747/api/discover` as JSON.

When a guest browser loads the app, the WebSocket handshake on
`ws://<server-ip>:4747/ws` is queued for approval. The operator on the
server machine approves it from the in-app "Pending connections" UI.
Loopback connections (the operator's own browser) are auto-approved.

If a guest browser cannot reach the server automatically, a connection
screen appears after ~10 seconds with a manual IP/port form and a "Retry
auto-discovery" button.

### Public display (second monitor)

Click **Open Public Display** in the private view — a new browser tab opens
at `/public`. Drag the tab to your second monitor and press **F11** for
fullscreen. The two tabs synchronize via the WebSocket state stream plus
`BroadcastChannel` so the public screen reflects scoreboard changes in real
time.

## Superadmin access

Hold **Alt + 1 + 2 + 3** simultaneously, then type **KARIAS** (case
insensitive) within 5 seconds. The superadmin overlay opens.

The chord is suppressed when an `<input>`, `<textarea>`, or
`contentEditable` element has focus, and a 1-second debounce prevents
accidental re-triggers. Press **Alt + 1 + 2 + 3** again to close the
overlay.

The chord delivers a short-lived local-admin token through
`POST /api/local-admin/issue`, which is gated to loopback (`127.0.0.1` /
`::1`). LAN browsers cannot obtain it.

## Data storage

All persistent state lives in `./data/` (created automatically on first run,
gitignored). The directory holds:

- `tournament.json` — bracket / category / scoring state
- `tournament-state.json` — authoritative live snapshot used by the WS engine
- `licenses.json` — claim codes and JWT lineage metadata
- `keys/` — Ed25519 signing keys for JWT issuance
- `activity.log` — audit trail
- `uploads/` — uploaded tournament logo

Set `KARATE_DATA_DIR=/some/path` to relocate the directory.
Set `KARATE_PORT=8080` to bind a different port.

## Security notes

- **Run on a trusted machine and a trusted network.** This is a LAN
  tournament tool, not a public-facing service.
- The web build stores its JWT in `sessionStorage` for the active tab and
  keeps an **AES-256-GCM encrypted copy in `localStorage`** so the session
  survives a tab close within the 24-hour token window. The encryption key
  is derived from a SHA-256 browser fingerprint (user-agent, screen,
  timezone, hardware concurrency) via `PBKDF2(100k, SHA-256)`. This is the
  strongest option in a pure browser context, but is **not OS-keychain
  strength**.
- Browser fingerprints are less stable than hardware IDs — clearing the
  browser profile, switching browsers, or major UA upgrades will rotate
  them and require re-activating the license.
- The local-admin (superadmin chord) token is loopback-only.

## Browser support

Chrome / Edge 90+, Firefox 90+, Safari 15+. Web Crypto, `WebSocket`, and
`EventSource` are all required.

## Development

```bash
pnpm --filter @karate/local dev   # local app server (tsx watch)
pnpm --filter @karate/web dev      # Next.js dev server (port 3000)
```

In dev the Next.js dev server runs on `:3000` and proxies to the API at
`:4747`. Set `NEXT_PUBLIC_KARATE_SERVER_URL=http://localhost:4747` if you
need to override the API base URL.
