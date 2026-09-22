<div align="center">

# Confinaid Test Tool

**A desktop harness for testing and monitoring Confinaid API integrations.**

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![pnpm](https://img.shields.io/badge/pnpm-managed-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg?logo=apache&logoColor=white)](./LICENSE)

</div>

> [!IMPORTANT]
> This tool holds a **Confinaid API secret key**. The secret is stored in your OS
> keychain (Keychain / Credential Manager / Secret Service) and never leaves the
> Rust process — it is not written to config files, logs, saved test cases, or
> exported reports. Never commit a real secret key, and redact reports before
> sharing them.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Status](#status)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Environment Variables](#environment-variables)
- [Building](#building)
- [Releases](#releases)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

|               |                                                                   |
| ------------- | ----------------------------------------------------------------- |
| **Type**      | Cross-platform desktop application                                |
| **Purpose**   | Test, load-test, monitor, and document Confinaid API integrations |
| **Auth**      | API secret key + client ID, held in the OS keychain               |
| **Platforms** | Windows · macOS · Linux                                           |
| **Shell**     | Tauri v2 (Rust core, React frontend)                              |
| **Version**   | v0.3.0                                                            |

Confinaid Test Tool is for engineers integrating a product with the Confinaid
Partner API. Rather than assembling ad-hoc `curl` scripts, it gives you a
persistent, multi-profile workspace to configure credentials, fire requests
interactively, author automated test suites, run load tests, and track a full
local history of every API call — all without sending data outside the machine.

---

## Features

### Connection — multi-profile credential management

- Store multiple named API profiles, each with its own base URL, client ID, and API secret.
- Secrets live in the OS keychain; only a 4-character hint is ever shown in the UI.
- Preset environments (Production / Beta) for one-click URL switching.
- Active profile indicator in the header; switch profiles without leaving any page.

### Requests — interactive API console

- **Single request**: choose an endpoint (`Analyze`, `Rewrite`, `Token`, `Refresh`, `Revoke`), edit the JSON body field-by-field or in raw JSON mode, and inspect the full response (status, headers, body, latency, size).
- **Bulk import**: drag-and-drop a `.jsonl` or `.csv` file — each row becomes a sequential API call with live progress and a per-row result table.
- All calls are logged to the local request log (feeds Monitoring and Reports).

### Playground — interactive compliance analysis

- Paste or type text and hit **Analyze** to get a verdict (`safe` / `risky` / `human review`), risk score, detected issues, and risk factors.
- Hit **Rewrite** on a flagged result to get a compliant rewrite of the content.
- Bearer tokens are fetched automatically in the background — no manual token step needed.
- All Playground calls are logged to the local request log.

### Test Suites — automated assertion-based testing

- Create named suites of test cases; each case fires one endpoint with a fixed body.
- **Assertions** can check: HTTP status code (`eq`, `ne`, `gte`, `lte`), JSON body field via dot-notation path (`eq`, `ne`, `contains`, `not_contains`, `exists`, `not_exists`), response header (`eq`, `contains`, `exists`), and latency (`≤ N ms`).
- Re-order cases with up/down buttons; edit or clear results without re-running.
- Run results shown inline — failed cases display the full raw response body for debugging.
- Each run is appended to a persisted history (capped at 500 entries) for the Reports page.

### Load & Rate Limit — throughput and boundary testing

Three test modes:

| Mode      | What it does                                                          |
| --------- | --------------------------------------------------------------------- |
| **Count** | Fire exactly N requests across C concurrent workers                   |
| **Time**  | Fire for T seconds across C concurrent workers                        |
| **Probe** | Ramp concurrency from Start → Max in steps, stopping at the first 429 |

Live stats update every 300 ms: requests sent, success, errors, 429s, throughput (req/s), latency percentiles (p50 / p95 / p99), and a status-code breakdown bar chart.

**Response Samples panel**: captures the first 5 response bodies per distinct status code so you can immediately read the API's error message without leaving the page. Each sample is individually expandable; the header shows the true total count.

### Reports — historical run analysis and export

Two tabs:

**Test Suites tab**

- Date-range filter (All time / Today / Last 7 days / Last 30 days / Custom).
- KPI tiles: Total Runs, Pass Rate, Cases Executed, Avg Duration.
- SVG donut chart (overall pass rate) + SVG bar chart (run trend, last 30 runs).
- Per-suite breakdown table.
- Expandable run history with per-case assertion detail and response body on failure.
- Delete individual runs or clear all history.
- Export filtered runs as **JSON**, **CSV**, or **HTML** (credentials never included).

**API Requests tab**

- Source filter: All / Requests / Bulk Import / Playground / Test Suites.
- Date-range filter (same presets as above).
- KPI strip: Total, Analyses, Rewrites, Clean, Risky, HITL.
- SVG line chart: API traffic trend.
- Paginated table (20 per page) with endpoint, content preview, source, duration, verdict.
- Export filtered entries as **JSON**, **CSV**, or **HTML**.

### Monitoring — local real-time dashboard

Mirrors the Confinaid frontend dashboard design using **local** request log data — no backend monitoring API required.

- 12 KPI tiles: Total Requests, Analyses, Rewrites, Safe, Risky, HITL, Safe Rate %, Avg Duration, Today / This Week / This Month counts, Error Rate.
- Filters: Date range, Source, Verdict, Endpoint.
- SVG line chart with Day / Week / Month granularity toggle.
- Paginated request table with eye button for full content detail.
- "Clear Log" button with confirmation.

### API Docs — offline documentation

- Embedded Confinaid API reference with code examples (curl, Node.js, Python, Go).
- Download button saves the PDF to a user-chosen location.

### Settings

- Theme: Light / Dark / System.
- Language: English, Turkish, German, French, Spanish — applied instantly app-wide.
- Auto-update: check on startup, auto-install toggles. Manual "Check for Updates" with inline progress bar.

---

## Status

All pages are fully implemented as of v0.3.0.

| Area              | State      | Notes                                                         |
| ----------------- | ---------- | ------------------------------------------------------------- |
| Connection        | ✅ Working | Multi-profile, OS keychain, preset environments               |
| Requests          | ✅ Working | Single + bulk import, JSONL/CSV, response viewer, logging     |
| Playground        | ✅ Working | Analyze + Rewrite, auto-token, findings, logged               |
| Test Suites       | ✅ Working | Suites, cases, assertions, reorder, history, per-case logging |
| Load & Rate Limit | ✅ Working | Count / Time / Probe modes, live stats, response samples      |
| Reports           | ✅ Working | Suites + API Requests tabs, date filter, charts, export       |
| Monitoring        | ✅ Working | Local dashboard, 12 KPIs, chart, filters, pagination          |
| API Docs          | ✅ Working | Embedded PDF viewer + download                                |
| Settings          | ✅ Working | Theme, language, auto-update                                  |

---

## Tech Stack

**Core** — Tauri v2 · Rust (stable) · React 19 · TypeScript 5 · Vite 7  
**Styling & UI** — Tailwind CSS v4 (CSS-first) · shadcn/ui primitives · Radix · lucide-react  
**State & data** — TanStack Query 5 · Zustand 5 (with `persist` middleware) · react-router 7 (hash router)  
**Forms** — react-hook-form · Zod 4  
**i18n** — i18next + react-i18next (5 languages, bundled — no HTTP fetches)  
**Secrets** — `keyring` v3, native backends on all three platforms  
**Tooling** — pnpm · ESLint 9 (flat) · Prettier · Vitest 4 · clippy · rustfmt · semantic-release

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│ React 19 + Vite  (webview)                                │
│   pages/ · components/layout/ · providers/ · stores/      │
│                                                            │
│   No network access. CSP connect-src allows only 'self'   │
│   and ipc: — every HTTP call goes through Rust.           │
├───────────────────────────────────────────────────────────┤
│ src/lib/api/  (typed IPC layer)                           │
│   commands{}    one entry per Rust command                │
│   TauriError    normalises { code, message, details }     │
│   queryKeys     hierarchical TanStack Query cache keys    │
│   request-logger  logRequest / logFailedRequest helpers   │
├──────────────────────── invoke ───────────────────────────┤
│ src-tauri/src/commands/   thin handlers                   │
├───────────────────────────────────────────────────────────┤
│ src-tauri/src/   Rust core                                │
│   error.rs        AppError — the IPC wire contract        │
│   config.rs       non-secret settings, atomic JSON write  │
│   credentials.rs  OS keychain; secret is write-only       │
│   state.rs        managed AppState + token cache          │
│   http/           reqwest client, bearer injection        │
└───────────────────────────────────────────────────────────┘
                              │
                              ▼
                     Confinaid Partner API (HTTPS)
```

Two design notes worth knowing before you contribute:

- **The API secret key crosses IPC in one direction only.** `save_credentials`
  accepts it; nothing returns it. Reads yield `hasSecret` and a four-character
  hint. Do not add a command that returns the value.
- **The webview has no network access.** The CSP permits no remote hosts. All
  HTTP calls belong in Rust, not in a `fetch()` call from React.
- **All local data is persisted in `localStorage`** via Zustand's `persist`
  middleware. Suite history is capped at 500 entries; the request log at 1,000.
  No data is sent anywhere.

---

## Project Structure

```
.
├── src/                          # React frontend
│   ├── components/
│   │   ├── layout/               # app-shell, app-sidebar, app-header
│   │   └── ui/                   # vendored shadcn primitives
│   ├── config/navigation.ts      # single source of truth for nav items
│   ├── lib/
│   │   ├── api/                  # typed IPC layer, errors, query client
│   │   │   ├── tauri-client.ts   # commands{} object — all Rust command names
│   │   │   ├── request-logger.ts # logRequest / logFailedRequest helpers
│   │   │   └── hooks/            # React Query hooks per domain
│   │   ├── suite-runner.ts       # assertion evaluation (pure TS)
│   │   └── i18n.ts               # i18next setup, 5 bundled locales
│   ├── pages/                    # one file per route
│   ├── providers/                # theme, query
│   ├── stores/                   # zustand slices (ui, suite, request-log, load, …)
│   ├── types/                    # TS mirrors of the Rust structs
│   ├── locales/                  # en · tr · de · fr · es JSON
│   └── router.tsx                # createHashRouter route table
├── src-tauri/
│   ├── src/
│   │   ├── commands/             # Tauri command handlers
│   │   ├── http/                 # reqwest client + endpoint bindings
│   │   ├── config.rs             # AppConfig (profiles, timeout)
│   │   ├── credentials.rs        # keychain custody
│   │   ├── state.rs              # AppState + bearer token cache
│   │   └── lib.rs                # builder, plugins, generate_handler!
│   ├── capabilities/             # Tauri permission model
│   └── tauri.conf.json
├── scripts/sync-version.mjs      # release version propagation
├── AGENT_CONTEXT.md              # comprehensive codebase reference for AI agents
├── Cargo.toml                    # workspace root
└── .github/workflows/            # ci · build · release
```

---

## Getting Started

### Prerequisites

| Tool              | Version | Notes                                                                       |
| ----------------- | ------- | --------------------------------------------------------------------------- |
| Node.js           | 22+     |                                                                             |
| pnpm              | 11+     | `corepack enable`                                                           |
| Rust              | stable  | via [rustup](https://rustup.rs/)                                            |
| Tauri system deps | —       | See [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) |

On Linux you additionally need `libsecret-1-dev` for keychain support:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  librsvg2-dev libxdo-dev libssl-dev patchelf libsecret-1-dev
```

### Installation

```bash
git clone https://github.com/Compuvi/confinaid-test-tool.git
cd confinaid-test-tool
pnpm install
pnpm tauri:dev
```

`pnpm dev` runs the frontend alone in a browser at `http://localhost:3000`, but
every IPC call fails there — use `pnpm tauri:dev` for anything that touches Rust.

### First run

1. Open the **Connection** page and fill in your API base URL (`https://api.confinaid.com` for production), Client ID, and Client secret. Click **Save profile**.
2. The active profile indicator appears in the top-right header. All subsequent API calls use this profile automatically.
3. Go to **Requests** → pick **Analyze** → send a request. The response, verdict, and risk score appear immediately.
4. Every call is logged — visit **Monitoring** or **Reports → API Requests** to see the history.

---

## Available Scripts

| Script               | Command                        | What it does                      |
| -------------------- | ------------------------------ | --------------------------------- |
| `pnpm dev`           | `vite`                         | Frontend only, port 3000          |
| `pnpm tauri:dev`     | `tauri dev`                    | Full desktop app                  |
| `pnpm build`         | `tsc -b && vite build`         | Typecheck and bundle the frontend |
| `pnpm tauri:build`   | `tauri build`                  | Platform installers               |
| `pnpm typecheck`     | `tsc --noEmit`                 | Types only                        |
| `pnpm lint`          | `eslint .`                     | Lint                              |
| `pnpm format`        | `prettier --write .`           | Format                            |
| `pnpm format:check`  | `prettier --check .`           | CI format gate                    |
| `pnpm test`          | `vitest run`                   | Frontend tests                    |
| `pnpm test:coverage` | `vitest run --coverage`        | Coverage report                   |
| `pnpm rust:fmt`      | `cargo fmt --all -- --check`   | Rust format gate                  |
| `pnpm rust:lint`     | `cargo clippy … -D warnings`   | Rust lint gate                    |
| `pnpm rust:test`     | `cargo test --workspace --lib` | Rust tests                        |

---

## Environment Variables

Copy `.env.example` to `.env`. Everything here is a **default**, never a secret —
the API secret key is entered in the app and stored in the OS keychain.

| Variable                    | Required | Description                                        | Example                          |
| --------------------------- | :------: | -------------------------------------------------- | -------------------------------- |
| `VITE_DEFAULT_API_BASE_URL` |    ⬜    | Pre-fills the API base URL on the Connection page. | `https://beta-api.confinaid.com` |

---

## Building

```bash
pnpm tauri:build
```

Artifacts land in `target/release/bundle/`: `.msi` and `.exe` on Windows, `.dmg`
and `.app` on macOS, `.AppImage` and `.deb` on Linux.

> [!NOTE]
> Builds are **unsigned**. macOS Gatekeeper and Windows SmartScreen will warn on
> first launch. Code signing is tracked separately — see [`RELEASING.md`](./RELEASING.md).

---

## Releases

Versioning is automated with [semantic-release](https://semantic-release.gitbook.io/)
from [Conventional Commits](https://www.conventionalcommits.org/). Merging to
`main` computes the next version, updates `CHANGELOG.md`, propagates the version
to `src-tauri/Cargo.toml` and `Cargo.lock`, and creates the GitHub release.
Pushing a `v*` tag builds and attaches installers for all three platforms.

Details in [`RELEASING.md`](./RELEASING.md).

---

## Security

The secret key is stored in the OS keychain and is write-only across the IPC
boundary. The webview has no outbound network access. See
[`SECURITY.md`](./SECURITY.md) for the full model and for how to report a
vulnerability — please use private reporting, not a public issue.

---

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the
branching model, commit convention, coding standards, and the definition of
done. By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

For a complete technical reference of how the app works — pages, stores, IPC
layer, data flows, Rust backend, and coding conventions — see
[`AGENT_CONTEXT.md`](./AGENT_CONTEXT.md).

---

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE) and
[`NOTICE`](./NOTICE).

```
Copyright 2026 Compuvi

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

**Trademarks.** The Apache License does not grant permission to use the trade
names, trademarks, or product names of Compuvi, except as required for
reasonable and customary use in describing the origin of the work.

**Contributions.** Contributions submitted for inclusion in this work are
licensed under Apache-2.0 (License § 5). There is no separate CLA.
