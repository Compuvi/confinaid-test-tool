<div align="center">

# Confinaid Test Tool

**A desktop harness for testing Confinaid API integrations.**

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

|               |                                                              |
| ------------- | ------------------------------------------------------------ |
| **Type**      | Cross-platform desktop application                           |
| **Purpose**   | Exercise the Confinaid API during and after integration work |
| **Auth**      | API secret key + client ID, held in the OS keychain          |
| **Platforms** | Windows · macOS · Linux                                      |
| **Shell**     | Tauri v2 (Rust core, web frontend)                           |

Confinaid Test Tool is for engineers integrating a product with the Confinaid
API. Rather than assembling ad-hoc curl scripts, it gives you a persistent
place to configure credentials, fire requests, and see how the API behaves
under sustained load and at the rate-limit boundary.

---

## Status

Early. The application shell, credential storage, and the release and CI
pipeline are in place. The testing features are not built yet — each page below
states what it will do.

| Area              | State      | Scope                                                             |
| ----------------- | ---------- | ----------------------------------------------------------------- |
| Connection        | ✅ Working | Save an API base URL, client ID and secret key to the OS keychain |
| Settings          | ✅ Working | Theme selection, runtime and version information                  |
| Requests          | ⬜ Planned | Single and bulk requests, CSV/JSONL import, response viewer       |
| Test Suites       | ⬜ Planned | Saved test cases with assertions, run a suite on demand           |
| Load & Rate Limit | ⬜ Planned | Concurrency control, p50/p95/p99 latency, 429 boundary probe      |
| Reports           | ⬜ Planned | Run history, per-run detail, export to JSON/CSV/HTML              |

---

## Tech Stack

**Core** — Tauri v2 · Rust (stable) · React 19 · TypeScript 5 · Vite 7
**Styling & UI** — Tailwind CSS v4 (CSS-first) · shadcn/ui primitives · Radix · lucide-react
**State & data** — TanStack Query 5 · Zustand 5 · react-router 7 (hash router)
**Forms** — react-hook-form · Zod 4
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
├──────────────────────── invoke ───────────────────────────┤
│ src-tauri/src/commands/   thin handlers                   │
├───────────────────────────────────────────────────────────┤
│ src-tauri/src/   Rust core                                │
│   error.rs        AppError — the IPC wire contract        │
│   config.rs       non-secret settings, atomic JSON write  │
│   credentials.rs  OS keychain; secret is write-only       │
│   state.rs        managed AppState                        │
│                                                            │
│   planned: http/ · runner/ · storage/                     │
└───────────────────────────────────────────────────────────┘
                              │
                              ▼
                     Confinaid API (HTTPS)
```

Two design notes worth knowing before you contribute:

- **The API secret key crosses IPC in one direction only.** `save_credentials`
  accepts it; nothing returns it. Reads yield `hasSecret` and a four-character
  hint. Do not add a command that returns the value — that would put it back in
  the renderer's heap and in every devtools snapshot.
- **The webview has no network access.** `withGlobalTauri` is off and the CSP
  permits no remote hosts. When the HTTP client lands it belongs in Rust, not in
  a `fetch()` call from React.

---

## Project Structure

```
.
├── src/                      # React frontend
│   ├── components/
│   │   ├── layout/           # app-shell, app-sidebar, app-header
│   │   └── ui/               # vendored shadcn primitives
│   ├── config/navigation.ts  # single source of truth for nav
│   ├── lib/api/              # typed IPC layer, errors, query client
│   ├── pages/                # one file per route
│   ├── providers/            # theme, query
│   ├── stores/               # zustand slices
│   ├── types/                # TS mirrors of the Rust structs
│   ├── __tests__/setup.ts    # blanket @tauri-apps mocks
│   └── router.tsx            # createHashRouter route table
├── src-tauri/
│   ├── src/
│   │   ├── commands/         # Tauri command handlers
│   │   ├── error.rs          # AppError
│   │   ├── config.rs         # AppConfig
│   │   ├── credentials.rs    # keychain custody
│   │   ├── state.rs          # AppState
│   │   └── lib.rs            # builder, plugins, generate_handler!
│   ├── capabilities/         # Tauri permission model
│   └── tauri.conf.json
├── scripts/sync-version.mjs  # release version propagation
├── Cargo.toml                # workspace root; artifacts in ./target
└── .github/workflows/        # ci · build · release
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
