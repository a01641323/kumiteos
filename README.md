# Kumite/OS

**Tournament management software for competitive karate — designed, built, and shipped solo in under three weeks.**

🔗 **Live:** [kumiteos.vercel.app](https://kumiteos.vercel.app) · **Request a demo code:** [kumiteos.vercel.app/request](https://kumiteos.vercel.app/request)

![Next.js](https://img.shields.io/badge/Next.js_15-000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Express](https://img.shields.io/badge/Express-000?logo=express&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-realtime-5A0EF8)
![Vercel](https://img.shields.io/badge/Vercel-000?logo=vercel&logoColor=white)

---

## The problem

Karate tournaments are still run on paper, whiteboards, and spreadsheets. Scores are tallied by hand, the public has no live scoreboard, and "dead areas" — competition zones idling while officials wait on manual coordination — waste hours over a single event. There was no affordable, self-hostable tool built for how these tournaments actually run on the day.

## What it does

Kumite/OS turns any laptop on the venue's network into a live tournament server. Officials score from their own devices, the public scoreboard updates in real time on a second monitor, and the whole thing runs offline on the host machine — no cloud dependency once it's started.

- **Role-aware scoring** — separate operator, judge, and public-display views, each scoped to what that role can see and do.
- **Real-time sync** — every connected device stays in lockstep over WebSocket; score a point and it lands everywhere instantly.
- **Public scoreboard** — a dedicated `/public` view for a second monitor, kept in sync via the WebSocket stream plus `BroadcastChannel`.
- **One-line installer** — detects the OS, downloads the binary, launches it, and opens the app in the browser. State persists locally and re-running is non-destructive.
- **Runs offline** — binds to the LAN and serves every device at the venue with no internet required.
- **Licensed activation** — short-lived JWTs issued from a cloud activation endpoint, with loopback-gated superadmin access for the host operator.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (App Router), React, Tailwind — statically exported |
| Local server | Node.js, Express, WebSocket, JWT, tournament state engine |
| Core logic | Pure TypeScript engine + types (`packages/core`) |
| Cloud activation | Next.js on Vercel — token requests, admin panel, JWT issuance |
| Security | Ed25519-signed JWTs, AES-256-GCM session encryption, PBKDF2 key derivation |

## Architecture at a glance

A monorepo with three apps and a shared core. The **cloud** app (Vercel) issues signed activation codes. The **local** app (a downloadable Express server) verifies them against the cloud's public key, runs the tournament engine, and serves the statically-exported **web** frontend to every device on the LAN. All tournament logic lives in a framework-agnostic `core` package.

```
kumiteos/
├── apps/
│   ├── web/    Next.js 15 (App Router) + Tailwind — statically exported to apps/web/out
│   ├── local/  Express + JWT + WebSocket + tournament state engine (downloadable binary)
│   └── cloud/  Next.js app on Vercel — token requests, admin panel, /api/activate (issues JWTs)
├── packages/
│   └── core/   Pure tournament/engine logic + types (TypeScript)
├── legacy/     Original single-file prototype (preserved for reference)
└── mock-participants.csv
```

---

## Install (operators)

One line. Detects your OS, downloads the binary, launches it, and opens `localhost:4747` in your browser. State persists at `~/.kumiteos/data/`, so re-running the installer is non-destructive.

**macOS / Linux**
```sh
curl -fsSL https://kumiteos.vercel.app/install.sh | sh
```

**Windows · PowerShell**
```powershell
iwr -useb https://kumiteos.vercel.app/install.ps1 | iex
```

Paste your 6-digit access code in the lock screen (request one at [kumiteos.vercel.app/request](https://kumiteos.vercel.app/request)).

## Install (contributors / source build)

```sh
pnpm install
pnpm build
```

The build produces a static frontend at `apps/web/out/` and a compiled server at `apps/local/dist/`. Run the server from source:

```sh
cd apps/local
KARATE_CLOUD_URL=https://kumiteos.vercel.app pnpm start
```

Drop the env var to run fully offline against a locally-issued claim code (no cloud activation):

```sh
pnpm start
```

Either way the server binds to `0.0.0.0:4747` and prints its reachable URLs on boot:

```
[karate-local] verifying JWTs with cloud public key from https://kumiteos.vercel.app
[karate-server] listening on http://0.0.0.0:4747
[karate-server] open on this machine: http://localhost:4747
[karate-server] open on the LAN: http://192.168.1.42:4747
[karate-server] admin panel: http://localhost:4747/admin-panel
```

## Accessing from other LAN machines

Any machine on the same network can open the app at `http://<server-machine-IP>:4747`. The server prints its LAN IPs on startup, and the same list is available at `http://localhost:4747/api/discover` as JSON.

When a guest browser loads the app, the WebSocket handshake on `ws://<server-ip>:4747/ws` is queued for approval. The operator on the server machine approves it from the in-app "Pending connections" UI. Loopback connections (the operator's own browser) are auto-approved.

If a guest browser cannot reach the server automatically, a connection screen appears after ~10 seconds with a manual IP/port form and a "Retry auto-discovery" button.

## Public display (second monitor)

Click **Open Public Display** in the private view — a new browser tab opens at `/public`. Drag the tab to your second monitor and press F11 for fullscreen. The two tabs synchronize via the WebSocket state stream plus `BroadcastChannel`, so the public screen reflects scoreboard changes in real time.

## Superadmin access

Hold `Alt + 1 + 2 + 3` simultaneously, then type `KARIAS` (case insensitive) within 5 seconds. The superadmin overlay opens.

The chord is suppressed when an `<input>`, `<textarea>`, or contentEditable element has focus, and a 1-second debounce prevents accidental re-triggers. Press `Alt + 1 + 2 + 3` again to close the overlay. The chord delivers a short-lived local-admin token through `POST /api/local-admin/issue`, which is gated to loopback (`127.0.0.1` / `::1`) — LAN browsers cannot obtain it.

## Data storage

All persistent state lives in `./data/` (created automatically on first run, gitignored):

- `tournament.json` — bracket / category / scoring state
- `tournament-state.json` — authoritative live snapshot used by the WS engine
- `licenses.json` — claim codes and JWT lineage metadata
- `keys/` — Ed25519 signing keys for JWT issuance
- `activity.log` — audit trail
- `uploads/` — uploaded tournament logo

Set `KARATE_DATA_DIR=/some/path` to relocate the directory. Set `KARATE_PORT=8080` to bind a different port.

## Security notes

- Run on a trusted machine and a trusted network. This is a LAN tournament tool, not a public-facing service.
- The web build stores its JWT in `sessionStorage` for the active tab and keeps an AES-256-GCM encrypted copy in `localStorage` so the session survives a tab close within the 24-hour token window. The encryption key is derived from a SHA-256 browser fingerprint (user-agent, screen, timezone, hardware concurrency) via PBKDF2 (100k, SHA-256). This is the strongest option in a pure browser context, but is not OS-keychain strength.
- Browser fingerprints are less stable than hardware IDs — clearing the browser profile, switching browsers, or major UA upgrades will rotate them and require re-activating the license.
- The local-admin (superadmin chord) token is loopback-only.

## Browser support

Chrome / Edge 90+, Firefox 90+, Safari 15+. Web Crypto, WebSocket, and EventSource are all required.

## Development

```sh
pnpm --filter @karate/local dev   # local app server (tsx watch)
pnpm --filter @karate/web dev     # Next.js dev server (port 3000)
```

In dev the Next.js dev server runs on `:3000` and proxies to the API at `:4747`. Set `NEXT_PUBLIC_KARATE_SERVER_URL=http://localhost:4747` if you need to override the API base URL.

---

Built by [Matías Hidalgo](https://github.com/a01641323).
