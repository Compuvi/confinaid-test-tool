# Confinaid Test Tool — Agent Context Document

> **Purpose of this file**: Give an AI agent complete working knowledge of this codebase so it can make accurate, consistent changes without re-exploring the code from scratch.

---

## 1. What the App Is

**Confinaid Test Tool** is a cross-platform desktop application (Windows, macOS, Linux) built with [Tauri v2](https://tauri.app). It is an internal developer and QA tool for testing the **Confinaid Partner API** — a compliance/content-moderation API that classifies and rewrites text.

The app lets operators:

- Configure API credentials and profiles.
- Fire individual API requests and inspect responses.
- Run text through the Playground (Analyze + Rewrite) interactively.
- Write and run automated test suites with assertion-based pass/fail logic.
- Run load and rate-limit tests.
- Browse a local monitoring dashboard of all API calls made through the app.
- Review detailed run reports with date filtering and export (JSON/CSV/HTML).
- Read the embedded API documentation.
- Manage app settings (theme, language, updates).

**No cloud sync. No login.** All data (credentials excluded — those go into the OS keychain) lives in `localStorage` via Zustand's `persist` middleware.

---

## 2. Tech Stack

| Layer                  | Technology                                           |
| ---------------------- | ---------------------------------------------------- |
| Desktop shell          | Tauri v2 (Rust backend + WebView frontend)           |
| Frontend language      | TypeScript + React 18                                |
| Build tool             | Vite                                                 |
| Package manager        | pnpm                                                 |
| UI components          | shadcn/ui (Radix UI primitives + Tailwind CSS v4)    |
| State management       | Zustand (with `persist` middleware for localStorage) |
| Server-state / caching | TanStack React Query v5                              |
| Routing                | React Router v7 (hash-based — `createHashRouter`)    |
| Internationalisation   | i18next + react-i18next                              |
| Rust HTTP client       | `reqwest` (async, with TLS)                          |
| Secret storage         | OS keychain via the `keyring` Rust crate             |
| Testing                | Vitest (unit), no e2e tests                          |

---

## 3. Repository Structure

```
confinaid-test-tool/
├── src/                          # Frontend (React/TypeScript)
│   ├── app.tsx                   # Root component, wraps providers
│   ├── main.tsx                  # Entry point, mounts React
│   ├── router.tsx                # Hash router + all routes
│   ├── components/
│   │   ├── layout/
│   │   │   ├── app-shell.tsx     # Root layout: sidebar + header + <Outlet>
│   │   │   ├── app-sidebar.tsx   # Collapsible nav sidebar
│   │   │   └── app-header.tsx    # Top bar with page title + breadcrumb
│   │   └── ui/                   # shadcn/ui component overrides
│   ├── config/
│   │   └── navigation.ts         # NAV_ITEMS — single source of truth for nav
│   ├── lib/
│   │   ├── api/
│   │   │   ├── tauri-client.ts   # `commands` object — typed Tauri IPC wrappers
│   │   │   ├── errors.ts         # TauriError class
│   │   │   ├── hooks/            # React Query hooks (credentials, request, etc.)
│   │   │   ├── index.ts          # Re-exports all hooks
│   │   │   ├── query-client.ts   # QueryClient singleton + query keys
│   │   │   └── request-logger.ts # logRequest / logFailedRequest helpers
│   │   ├── findings.ts           # Shared logic for parsing Analyze responses
│   │   ├── i18n.ts               # i18next config (5 languages, bundled)
│   │   ├── suite-runner.ts       # Assertion evaluation (pure TS, no IPC)
│   │   └── utils.ts              # cn() and other utilities
│   ├── pages/                    # One file per route
│   │   ├── connection.tsx
│   │   ├── requests.tsx
│   │   ├── playground.tsx
│   │   ├── suites.tsx
│   │   ├── load.tsx
│   │   ├── reports.tsx
│   │   ├── monitoring.tsx
│   │   ├── docs.tsx
│   │   └── settings.tsx
│   ├── providers/
│   │   ├── query-provider.tsx    # React Query provider
│   │   └── theme-provider.tsx    # light/dark/system theme
│   ├── stores/                   # Zustand stores
│   │   ├── ui-store.ts           # Sidebar collapse, language, update prefs
│   │   ├── suite-store.ts        # Suites, test cases, run history
│   │   ├── request-store.ts      # Requests page state (endpoint, body, response)
│   │   ├── bulk-store.ts         # Bulk import state (rows, progress)
│   │   ├── load-store.ts         # Load test state
│   │   ├── request-log-store.ts  # Local API call log (feeds Monitoring page)
│   │   └── updater-store.ts      # Update check/install phase
│   ├── types/                    # TypeScript types (mirroring Rust structs)
│   │   ├── credentials.ts
│   │   ├── request.ts
│   │   ├── suite.ts
│   │   ├── request-log.ts
│   │   ├── monitoring.ts
│   │   ├── app.ts
│   │   └── updater.ts
│   └── locales/                  # i18n JSON files
│       ├── en.json, tr.json, de.json, fr.json, es.json
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Tauri builder, invoke_handler registration
│   │   ├── state.rs              # AppState (Arc<Mutex<AppConfig>> + token cache)
│   │   ├── config.rs             # AppConfig, ProfileSettings — JSON on disk
│   │   ├── credentials.rs        # OS keychain read/write
│   │   ├── error.rs              # AppError enum, AppResult alias
│   │   ├── updater.rs            # Self-update logic
│   │   ├── commands/
│   │   │   ├── app.rs            # get_app_version, get_runtime_info
│   │   │   ├── credentials.rs    # save/load/list/switch/delete/clear profiles
│   │   │   ├── request.rs        # send_request, get_token_status
│   │   │   └── monitoring.rs     # list_monitoring_records, get_monitoring_summary, get_monitoring_record
│   │   └── http/
│   │       └── endpoints.rs      # reqwest calls, token cache, bearer injection
│   └── tauri.conf.json
├── public/
│   └── api-docs.pdf              # Embedded API documentation PDF
└── CHANGELOG.md
```

---

## 4. Routing

Uses **hash routing** (`createHashRouter`) because Tauri's custom protocol asset resolver does not fall back to `index.html` for unknown paths, so standard browser routing would 404 on reload.

Default route `/` redirects to `/connection`.

| Route         | Page Component   | Nav Icon     |
| ------------- | ---------------- | ------------ |
| `/connection` | `ConnectionPage` | PlugZap      |
| `/requests`   | `RequestsPage`   | Send         |
| `/playground` | `PlaygroundPage` | Shield       |
| `/suites`     | `SuitesPage`     | FlaskConical |
| `/load`       | `LoadPage`       | Gauge        |
| `/reports`    | `ReportsPage`    | FileBarChart |
| `/monitoring` | `MonitoringPage` | Activity     |
| `/docs`       | `DocsPage`       | BookOpen     |
| `/settings`   | `SettingsPage`   | Settings2    |

All routes are children of `AppShell`, which renders the sidebar + header + `<Outlet>`.

---

## 5. Layout

### `AppShell` (`components/layout/app-shell.tsx`)

- Renders `AppSidebar` (left) + a scrollable main area.
- `AppHeader` sits at the top of the main area.
- Uses `useUiStore` to know if sidebar is collapsed.

### `AppSidebar` (`components/layout/app-sidebar.tsx`)

- Width: `w-[72px]` (collapsed) / `w-60` (expanded).
- Iterates `NAV_ITEMS` from `config/navigation.ts`.
- **Collapsed state**: Each item is a `div.flex.justify-center` wrapper (full 72px width) containing a `Tooltip` → `NavLink` (w-9, py-2). The wrapper div gets `bg-sidebar-accent` when the route is active (checked via `useLocation` from react-router). Tooltip shows the label on hover.
- **Expanded state**: Each item is a `w-full NavLink` with icon + label text.
- Collapse toggle button in the footer area.
- Version number shown in footer when expanded.
- Logo (`/favicon.png`) centered when collapsed; expands to show "Confinaid / Test Tool" text.

### `AppHeader` (`components/layout/app-header.tsx`)

- Resolves current page title and description via `findNavItem(pathname)`.
- Shows `ThemeToggle` button.

---

## 6. Pages — Detailed Reference

### 6.1 Connection (`/connection`)

**Purpose**: Manage API credential profiles.

**Key features**:

- Multi-profile support: create, edit, switch, delete named profiles.
- Non-secret fields (profile name, API base URL, client ID) stored in `config.json` on disk.
- API secret key stored in the OS keychain — **never returned to the frontend after saving**. The UI only gets `hasSecret: boolean` and `secretHint: string | null` (last 4 chars).
- Two preset environment buttons: Production (`https://api.confinaid.com`) and Beta (`https://beta.confinaid.com`).
- Zod schema validates the form; `react-hook-form` manages state.
- Profile list shown on the left; form on the right.
- Active profile selector at the top-left of the app indicates which profile is in use for all API calls.

**Stores used**: React Query hooks — `useStoredCredentials`, `useListProfiles`, `useSaveCredentials`, `useSwitchProfile`, `useDeleteProfile` (all in `lib/api/hooks/use-credentials.ts`).

**Rust commands called**: `save_credentials`, `load_credentials`, `list_profiles`, `switch_profile`, `delete_profile`, `clear_credentials`.

---

### 6.2 Requests (`/requests`)

**Purpose**: Fire individual API requests to the Confinaid Partner API.

**Key features**:

- **Endpoint selector**: Choose from `Analyze`, `Rewrite`, `Token`, `Refresh`, `Revoke`.
- **Body editor**: Dynamic form fields per endpoint. The body is JSON sent verbatim.
- **Single request**: `Send` button fires one request and shows the response (status, duration, size, headers, body).
- **Bulk import**: Upload a CSV/JSON file where each row becomes a separate API request. Rows are processed sequentially with a progress indicator.
- **Token status**: Shows the cached bearer token hint (last 8 chars + expiry) obtained automatically by Rust on first request.
- All requests (single and bulk) are logged to `request-log-store` via `logRequest`/`logFailedRequest`.

**Stores used**: `useRequestStore` (endpoint, body, response), `useBulkStore` (bulk rows, progress).

**Rust commands**: `send_request`, `get_token_status`.

---

### 6.3 Playground (`/playground`)

**Purpose**: Interactive compliance analysis and rewriting of text content.

**Key features**:

- Large text input area for the content to analyze.
- **Analyze** button calls the `Analyze` endpoint and shows:
  - Verdict badge: `safe` (green), `risky` (red), `hitl` / human-in-the-loop (amber).
  - Risk score (0–100%).
  - Detected issues / findings list.
  - Risk factors breakdown.
- **Rewrite** button (enabled after a risky/hitl verdict) calls the `Rewrite` endpoint and shows the rewritten text.
- "Apply to editor" button replaces the input with the rewritten text.
- Bypass notice shown when a filtering profile covers the content.
- The Playground fetches bearer tokens automatically in the background — users never need to call the Token endpoint manually. (This is noted as an info hint in the empty state.)
- All Analyze and Rewrite calls are logged to `request-log-store`.

**Verdict derivation**: Uses `deriveVerdict()` from `lib/api/request-logger.ts`, which checks `status`, `verdict`, `risk_status`, `decision` fields with a fallback to `risk_score` thresholds (≥0.7 = risky, ≥0.3 = hitl).

---

### 6.4 Test Suites (`/suites`)

**Purpose**: Author and run automated test suites against the API.

**Key concepts**:

- A **Suite** is a named, ordered list of **TestCases**.
- A **TestCase** fires one request to one endpoint with a specific body, then evaluates **Assertions**.
- **Assertions** can check: HTTP status code, JSON body field (dot-notation path), response header, or response latency.
- The suite runner executes cases **sequentially** (not parallel) using the existing `send_request` Tauri command — no dedicated Rust runner.

**Assertion types**:

| Type      | Operators                                                      | Notes                            |
| --------- | -------------------------------------------------------------- | -------------------------------- |
| `status`  | `eq`, `ne`, `gte`, `lte`                                       | Checks HTTP status code          |
| `body`    | `eq`, `ne`, `contains`, `not_contains`, `exists`, `not_exists` | Dot-notation path into JSON body |
| `header`  | `eq`, `contains`, `exists`                                     | Case-insensitive header name     |
| `latency` | `lte`                                                          | Response round-trip in ms        |

**Key features**:

- Create/edit/delete suites and test cases.
- Drag-and-drop case reordering (up/down buttons).
- Run a suite → results shown inline per-case with pass/fail badge and assertion detail.
- Failed cases show the raw response body so users can debug API errors.
- Clear run results without deleting the suite.
- After each run, the `SuiteRunResult` is prepended to `runHistory` in `suite-store` (capped at 500 entries) for the Reports page.
- Each individual case request is also logged to `request-log-store` (source: `"suite"`).

**Assertion path autocomplete**: The body assertion path field has a dropdown of common Confinaid response fields (e.g., `status`, `risk_score`, `data.entities`) plus a free-text "custom" option.

**Stores used**: `useSuiteStore`.

**Rust commands**: `send_request`.

---

### 6.5 Load & Rate Limit (`/load`)

**Purpose**: Stress-test the API with concurrent or rapid requests to discover rate limits and measure latency under load.

**Key features**:

- Configure: endpoint, request body, concurrency, total requests, ramp-up, delay between batches.
- Start/stop the test. Reset button clears results.
- Real-time progress (flushed every 300 ms): requests sent, success, errors, rate-limited counts.
- Results: latency histogram (p50/p95/p99, min/avg/max), requests-per-second, status code breakdown.
- Detects 429 Too Many Requests responses and highlights rate limit thresholds.
- **Response Samples panel**: captures the first response body per distinct HTTP status code (and up to 5 network error messages). Each row is collapsible and shows the status code, URL, duration, and full raw response body — used to debug unexpected 4xx/5xx errors without leaving the page.

**Stores used**: `useLoadStore`.

**Rust commands**: `send_request` (called repeatedly from the frontend; a dedicated Rust runner is planned but not yet implemented).

---

### 6.6 Reports (`/reports`)

**Purpose**: Historical view of all test suite runs and individual API requests, with charts, filtering, and export.

**Data sources**:

- **Test Suites tab**: `useSuiteStore().runHistory` — persisted array of `SuiteRunResult`, capped at 500.
- **API Requests tab**: `useRequestLogStore().entries` — persisted array of `RequestLogEntry`, capped at 1,000.

**Test Suites tab features**:

- **Date-range filter** (All time / Today / Last 7 days / Last 30 days / Custom range) — filters everything: KPI tiles, charts, breakdown table, and run list.
- KPI tiles: Total Runs, Pass Rate, Cases Run, Avg Duration.
- SVG donut chart: overall pass rate.
- SVG bar chart: run trend (last 20 runs), colour-coded pass/fail.
- Per-suite breakdown table: runs per suite, pass/fail counts.
- Expandable run history list (search by suite name, filter by outcome, sort by newest/oldest/duration).
- Each run row expands to show per-case results with assertion detail.
- Delete individual runs or clear all history.
- Export filtered runs as **JSON**, **CSV**, or **HTML** (credentials are never included; response bodies stripped).

**API Requests tab features**:

- Source filter pills: All / Requests / Bulk / Playground / Test Suites.
- **Date-range filter** (same presets as above).
- KPI strip: Total, Analyses, Rewrites, Clean, Risky, HITL.
- SVG line chart: API traffic trend over time.
- Paginated table (20 per page) with columns: Date, Endpoint, Content preview, Source, Duration, Verdict.
- Eye button opens a detail dialog with full content and risk score.
- Export filtered entries as **JSON**, **CSV**, or **HTML**.

**Key shared components**:

- `DateRangeFilter` — reusable pill + date-input component.
- `KpiCard` — small metric tile.
- `LogLineChart` — SVG line chart for API traffic.
- `DonutChart`, `TrendBars` — SVG charts for suite stats.

---

### 6.7 Monitoring (`/monitoring`)

**Purpose**: Local real-time dashboard of all API calls made through the app (no backend required).

**Data source**: `useRequestLogStore().entries` (same store as Reports / API Requests tab). The monitoring page does **not** call any backend monitoring API — it only reads local data.

**Features**:

- 12 KPI tiles: Total Requests, Total Analyses, Total Rewrites, Safe count, Risky count, HITL count, Safe Rate %, Avg Duration, Requests Today, Requests This Week, Requests This Month, Error Rate.
- Filters: Date range (Today / This Week / This Month / All), Source (All / Requests / Bulk Import / Playground / Test Suites), Verdict (All / Safe / Risky / HITL), Endpoint (All / Analyze / Rewrite / Token / Refresh / Revoke).
- SVG line chart: API traffic trend with Day/Week/Month granularity toggle.
- Paginated table (20 per page, always visible when there are entries): Date, Endpoint, Content preview, Source, Duration, Verdict. Eye button for full detail dialog.
- "Clear Log" button wipes `request-log-store`.
- Pagination shows "X–Y of Z" count even on single-page results.

---

### 6.8 API Docs (`/docs`)

**Purpose**: Embedded offline API documentation.

**Features**:

- Renders the Confinaid API documentation from the bundled `/public/api-docs.pdf`.
- Download button saves the PDF to the user's chosen location via `@tauri-apps/plugin-dialog` (`save`) + `@tauri-apps/plugin-fs` (`writeFile`).
- Custom scrollbar (single scrollbar at the edge, not nested).

---

### 6.9 Settings (`/settings`)

**Purpose**: App preferences.

**Sections**:

- **Appearance**: Theme selector (Light / Dark / System).
- **Language**: Dropdown for 5 supported languages (English, Turkish, German, French, Spanish). Change takes effect immediately.
- **Updates**: Toggle auto-check on startup; toggle auto-install. Manual "Check for updates" button. Shows current version and release notes link. Inline install progress bar.

**Stores used**: `useUiStore` (sidebar, language, update prefs), `useUpdaterStore` (check result, install phase), `useTheme` (from `theme-provider`).

**Rust commands**: `check_for_updates`, `install_update`.

---

## 7. State Management

All Zustand stores use the `persist` middleware (localStorage) unless noted as ephemeral.

### `useUiStore` (`stores/ui-store.ts`)

| State                | Type           | Persisted | Default |
| -------------------- | -------------- | --------- | ------- |
| `sidebarCollapsed`   | `boolean`      | ✅        | `false` |
| `language`           | `LanguageCode` | ✅        | `"en"`  |
| `autoUpdateEnabled`  | `boolean`      | ✅        | `true`  |
| `autoInstallEnabled` | `boolean`      | ✅        | `true`  |

Key: `"confinaid-test-tool-ui"`

### `useSuiteStore` (`stores/suite-store.ts`)

| State             | Type                             | Persisted    |
| ----------------- | -------------------------------- | ------------ |
| `suites`          | `Suite[]`                        | ✅           |
| `selectedSuiteId` | `string \| null`                 | ✅           |
| `runHistory`      | `SuiteRunResult[]` (max 500)     | ✅           |
| `runResults`      | `Record<string, SuiteRunResult>` | ❌ ephemeral |
| `runningSuiteIds` | `Set<string>`                    | ❌ ephemeral |

Key: `"confinaid-test-tool-suites"`

Actions: `createSuite`, `updateSuite`, `deleteSuite`, `selectSuite`, `addCase`, `updateCase`, `deleteCase`, `reorderCase`, `setRunResult`, `clearRunResult`, `setRunning`, `addRunHistory`, `deleteHistoryEntry`, `clearHistory`.

### `useRequestLogStore` (`stores/request-log-store.ts`)

| State     | Type                                          | Persisted |
| --------- | --------------------------------------------- | --------- |
| `entries` | `RequestLogEntry[]` (max 1,000, newest first) | ✅        |

Key: `"confinaid-test-tool-request-log"`

Actions: `addEntry`, `clearLog`.

### `useRequestStore` (`stores/request-store.ts`)

Manages state for the Requests page: selected endpoint, request body, last response. **Ephemeral** (no persist).

### `useBulkStore` (`stores/bulk-store.ts`)

Manages bulk import state: loaded rows, processing state, per-row results. **Ephemeral**.

### `useLoadStore` (`stores/load-store.ts`)

Manages load test configuration and results. **Ephemeral**.

### `useUpdaterStore` (`stores/updater-store.ts`)

Manages update check result, checking flag, and install phase. **Ephemeral**.

---

## 8. The `commands` Object (IPC Layer)

**File**: `src/lib/api/tauri-client.ts`

This is the **only place** Rust command names appear in the frontend. All pages call through this object instead of calling `invoke()` directly.

```typescript
commands.app.getVersion()            → "get_app_version"
commands.app.getRuntimeInfo()        → "get_runtime_info"

commands.credentials.save(...)       → "save_credentials"
commands.credentials.load()          → "load_credentials"
commands.credentials.list()          → "list_profiles"
commands.credentials.switch(...)     → "switch_profile"
commands.credentials.delete(...)     → "delete_profile"
commands.credentials.clear()         → "clear_credentials"

commands.request.send(...)           → "send_request"          (2 min timeout)
commands.request.getTokenStatus()    → "get_token_status"

commands.updater.checkForUpdates()   → "check_for_updates"
commands.updater.installUpdate(...)  → "install_update"

commands.monitoring.listRecords(...) → "list_monitoring_records"
commands.monitoring.getSummary(...)  → "get_monitoring_summary"
commands.monitoring.getRecord(...)   → "get_monitoring_record"
```

Errors thrown by Rust are caught and wrapped as `TauriError` instances (see `lib/api/errors.ts`). Error codes: `"NETWORK_ERROR"`, `"UNAUTHORIZED"`, `"RATE_LIMITED"`, `"VALIDATION_ERROR"`, `"INTERNAL_ERROR"`.

---

## 9. Request Logging System

**File**: `src/lib/api/request-logger.ts`

Every page that calls `commands.request.send()` calls one of these helpers after the response:

```typescript
logRequest({ endpoint, requestBody, result, source, sourceName });
logFailedRequest({ endpoint, requestBody, error, source, sourceName });
```

These derive the verdict and risk score from the response body and append a `RequestLogEntry` to `useRequestLogStore`. This powers both the **Monitoring** page and the **Reports → API Requests** tab.

**Source values** (`RequestSource`):

- `"requests"` — single request from the Requests page
- `"bulk"` — one row of a bulk import from the Requests page
- `"playground"` — Analyze or Rewrite from the Playground
- `"suite"` — one test case from a Suite run

**Verdict derivation** (`deriveVerdict`):

1. Check `response.status`, `response.verdict`, `response.risk_status`, `response.decision` fields (in that order).
2. If none found, fall back to `risk_score`: ≥0.7 → `"risky"`, ≥0.3 → `"hitl"`, else `"safe"`.
3. Returns `null` for non-Analyze endpoints.

---

## 10. Rust Backend

### Entry Point (`src-tauri/src/lib.rs`)

Registers all Tauri plugins and commands, initialises `AppState`, loads config from disk on startup.

**Plugins registered**:

- `tauri_plugin_dialog` (save-file dialogs)
- `tauri_plugin_fs` (write files)
- `tauri_plugin_opener` (open URLs in browser)

### `AppState` (`state.rs`)

- `Arc<Mutex<AppConfig>>` — thread-safe config.
- Token cache: `Arc<Mutex<Option<CachedToken>>>` — stores the current bearer token so it is reused across requests without re-fetching.

### Config (`config.rs`)

Persisted as `config.json` in Tauri's app data directory.

```rust
AppConfig {
    profiles: HashMap<String, ProfileSettings>,  // keyed by profile name
    active_profile: Option<String>,
    request_timeout_ms: u64,                     // default 30,000 ms
    // legacy single-profile fields (v0.2.x) — read-only for migration
    api_base_url: String,
    client_id: String,
}

ProfileSettings {
    api_base_url: String,       // default "https://api.confinaid.com"
    client_id: String,
    company_id: Option<String>, // for monitoring endpoints (unused in UI)
    monitoring_url: Option<String>, // separate monitoring backend URL (unused in UI)
}
```

### Credentials (`credentials.rs` + `commands/credentials.rs`)

- API secret key stored in OS keychain under key `"confinaid-test-tool:{profile_name}"`.
- The secret **never** leaves the Rust process after being stored.
- `CredentialInput` accepts the secret; `StoredCredentialProfile` returns `hasSecret` + `secretHint` (last 4 chars) only.

### Request Handling (`commands/request.rs`, `http/endpoints.rs`)

`send_request` flow:

1. Read the active profile name from `AppState`.
2. Look up `ProfileSettings` for that profile from config.
3. Read the API secret from the OS keychain.
4. Check the in-memory token cache. If the token exists and is not expired, reuse it.
5. If no valid token: call `POST /v1/token` with `client_id` + `client_secret` → cache the result.
6. Fire the requested endpoint with the bearer token.
7. Return `RequestResult` (status, body, headers, duration, size).

Supported endpoints:

| `EndpointId` | HTTP | Path                 |
| ------------ | ---- | -------------------- |
| `Token`      | POST | `/v1/token/`         |
| `Refresh`    | POST | `/v1/token/refresh/` |
| `Revoke`     | POST | `/v1/token/revoke/`  |
| `Analyze`    | POST | `/v1/analyze/`       |
| `Rewrite`    | POST | `/v1/rewrite/`       |

### Monitoring Commands (`commands/monitoring.rs`)

These commands hit a **separate backend** (dashboard API, not the partner API) and require `company_id` configured on the profile. In the current UI these fields are hidden — the monitoring page uses local data instead.

---

## 11. Internationalisation

**File**: `src/lib/i18n.ts`

- 5 languages: English (`en`), Turkish (`tr`), German (`de`), French (`fr`), Spanish (`es`).
- Translation files: `src/locales/{lang}.json` — bundled at build time, no HTTP fetches.
- Language preference persisted in `useUiStore`.
- Change via `useUiStore().setLanguage(code)` — immediately applies to the entire app.

Translation key structure (top-level namespaces in each JSON):
`nav`, `connection`, `requests`, `playground`, `suites`, `load`, `reports`, `monitoring`, `docs`, `settings`, `common`, `errors`.

---

## 12. Theme System

**File**: `src/providers/theme-provider.tsx`

- Three modes: `"light"`, `"dark"`, `"system"`.
- Stored in `localStorage` under key `"confinaid-test-tool-theme"` (separate from Zustand, using a simple context).
- Applied by toggling `class="dark"` on `<html>`.
- Tailwind CSS v4 dark-mode via `@media (prefers-color-scheme)` + class override.

---

## 13. Update System

**Files**: `stores/updater-store.ts`, `components/ui/update-banner.tsx`, `src-tauri/src/updater.rs`

- On startup: `check_for_updates` Tauri command is called if `autoUpdateEnabled` is true.
- If an update is found: a banner appears with version info and a download/install button.
- `install_update` downloads the installer (streams `update-download-progress` events to the UI), verifies the SHA-256 checksum, and launches the installer. On Windows (MSI path), UAC elevation is requested via a PowerShell helper. The app exits after installer launch.
- Install progress is tracked in `useUpdaterStore.installPhase`.

---

## 14. Data Persistence Summary

| Store key                         | Contents                              | Cap                     |
| --------------------------------- | ------------------------------------- | ----------------------- |
| `confinaid-test-tool-ui`          | Sidebar state, language, update prefs | —                       |
| `confinaid-test-tool-suites`      | Suites, test cases, run history       | 500 run history entries |
| `confinaid-test-tool-request-log` | All logged API calls                  | 1,000 entries           |
| `confinaid-test-tool-theme`       | Theme preference                      | —                       |
| OS keychain                       | API secret keys, one per profile      | —                       |
| `{appDataDir}/config.json`        | Profile settings (non-secret)         | —                       |

---

## 15. Key Data Flows

### How a Single API Request Is Fired

```
User clicks "Send" on Requests page
→ RequestsPage calls commands.request.send({ params })
→ Tauri IPC → send_request (Rust)
  → Read active profile from AppState
  → Check token cache → fetch token if needed (POST /v1/token)
  → Fire endpoint with bearer token (reqwest)
  → Return RequestResult
→ Frontend receives RequestResult
→ logRequest() → useRequestLogStore.addEntry()
→ UI renders response panel
```

### How a Suite Run Works

```
User clicks "Run" on SuitesPage
→ For each TestCase in suite (sequentially):
  → commands.request.send({ endpoint, body, timeoutMs })
  → Receive RequestResult
  → evaluateAssertions(testCase.assertions, result) → AssertionResult[]
  → logRequest() → useRequestLogStore.addEntry() [source: "suite"]
  → Accumulate CaseResult
→ Build SuiteRunResult (passed/failed/total/caseResults)
→ useSuiteStore.setRunResult(suiteId, result) [ephemeral, for current UI]
→ useSuiteStore.addRunHistory(result) [persisted, for Reports]
```

### How Monitoring Data Is Built

No backend calls. The monitoring page:

```
MonitoringPage renders
→ const { entries } = useRequestLogStore()
→ Apply filters (date, source, verdict, endpoint)
→ Compute KPI tiles from filtered entries
→ Build SVG line chart buckets from filtered entries
→ Slice into pages for the table
```

---

## 16. Important Conventions

1. **Never call `invoke()` directly** — always go through `commands.*` in `tauri-client.ts`.
2. **Never add a new nav item without updating `NAV_ITEMS`** in `config/navigation.ts` — the sidebar and header both source from it.
3. **Every API call must call `logRequest` or `logFailedRequest`** from `lib/api/request-logger.ts` — this is how the Monitoring and Reports pages get their data.
4. **Rust command names are snake_case**; their TypeScript wrappers are camelCase in the `commands` object.
5. **Translation keys** must be added to **all 5 locale files** (`en`, `tr`, `de`, `fr`, `es`) simultaneously.
6. **Before committing**: run `pnpm tsc --noEmit`, `pnpm format`, `cargo clippy --all-targets`, `cargo fmt --all`. The pre-commit hook enforces all of these.
7. **Zustand stores with `persist`**: only include serialisable data in `partialize`. Sets (like `runningSuiteIds`) are excluded because they don't serialise cleanly.
8. **AppError types** from Rust are caught as `TauriError` on the frontend — check `error.code` to branch on network vs auth vs validation errors.

---

## 17. Version

Current version: **0.2.3** (as of this document).  
Defined in `package.json` and `src-tauri/Cargo.toml`. Kept in sync by the release workflow (`scripts/sync-version.mjs`).

Branch strategy:

- `main` — stable releases, version bumps via semantic-release.
- `dev` — active development; PRs merge here first, then to `main`.
