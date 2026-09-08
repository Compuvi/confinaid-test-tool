# Contributing to Confinaid Test Tool

Thanks for your interest. This document covers how to set up the project, the
conventions the codebase follows, and what "done" means before you open a pull
request.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Branching Model](#branching-model)
- [Commit Convention](#commit-convention)
- [Pull Requests](#pull-requests)
- [Coding Standards](#coding-standards)
  - [TypeScript & React](#typescript--react)
  - [Rust](#rust)
- [The IPC Boundary](#the-ipc-boundary)
- [Credential Handling](#credential-handling)
- [State Management](#state-management)
- [Styling](#styling)
- [Testing](#testing)
- [Definition of Done](#definition-of-done)
- [Licensing of Contributions](#licensing-of-contributions)

---

## Development Setup

This repo is **pnpm-only**. You also need a Rust stable toolchain and the
[Tauri system prerequisites](https://tauri.app/start/prerequisites/) for your
platform.

```bash
corepack enable          # provides pnpm
pnpm install             # installs deps and the git hooks (see "prepare")
pnpm tauri:dev           # runs the full desktop app
```

`pnpm dev` starts the frontend alone in a browser. Every IPC call fails there,
so use `pnpm tauri:dev` for anything touching Rust.

The `prepare` script points git at `.githooks/`, which runs a typecheck and both
format checks before each commit. Skip with `--no-verify` when you need to.

---

## Branching Model

| Branch                     | Purpose                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `main`                     | Release branch. Merges trigger `semantic-release`. Do not push directly. |
| `<username>/<type>/<desc>` | Working branches.                                                        |

Branch names carry the author, then a Conventional Commit type, then a short
kebab-case description:

```
emrementese/feat/bulk-request-import
emrementese/fix/keychain-linux-prompt
emrementese/chore/bump-tauri
```

---

## Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/). The type
determines the released version, so it is not decorative.

```
<type>(<optional scope>): <short summary>

<optional body — explain why, not what>

<optional footer, e.g. BREAKING CHANGE: ...>
```

| Type       | Use for                                | Release   |
| ---------- | -------------------------------------- | --------- |
| `feat`     | A new capability                       | **minor** |
| `fix`      | A bug fix                              | **patch** |
| `perf`     | A performance improvement              | patch     |
| `refactor` | Neither fixes a bug nor adds a feature | none      |
| `docs`     | Documentation only                     | none      |
| `style`    | Formatting, no logic change            | none      |
| `test`     | Adding or adjusting tests              | none      |
| `build`    | Build system or dependencies           | none      |
| `ci`       | CI configuration                       | none      |
| `chore`    | Tooling and maintenance                | none      |

`feat!:`, `fix!:` or a `BREAKING CHANGE:` footer produces a **major** release.

Scopes are free-form and name the area touched: `api`, `ui`, `credentials`,
`runner`, `reports`, `deps`. Summaries are imperative, lowercase, no trailing
period.

---

## Pull Requests

- Base your branch on `main`.
- Keep PRs to one concern. A small PR gets a real review; a large one gets a
  skim.
- Title in Conventional Commit form — it becomes the squashed commit message.
- Describe **what** changed and **why**. Link the issue.
- Include a screenshot or clip for UI changes, in both themes.
- CI must be green. Prefer squash-merge so release notes stay readable.

---

## Coding Standards

### TypeScript & React

- **Filenames are kebab-case**, without exception — `app-sidebar.tsx`,
  `use-credentials.ts`, `ui-store.ts`. Components inside are PascalCase.
- Strict TypeScript. Prefix intentionally unused bindings with `_`.
- Import with the `@/` alias, not relative traversal.
- One route per file in `src/pages/`. Add the route to `src/router.tsx` and the
  nav entry to `src/config/navigation.ts` — the sidebar and header both read
  that file, so it stays the only place a page is listed.
- `src/components/ui/` is vendored from shadcn/ui. Keep it close to upstream so
  `shadcn diff` remains useful; put app-specific components elsewhere.

### Rust

- `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings`
  both gate CI. Run them before pushing.
- **Every `.rs` file starts with `// SPDX-License-Identifier: Apache-2.0`.**
  TypeScript files do not carry a header — the repository `LICENSE` covers them,
  and `src/components/ui/` is vendored.
- Commands live in `src-tauri/src/commands/`; domain logic lives in its own
  module and takes no `AppHandle`. That separation is what lets `cargo test
--lib` run the whole domain layer without a Tauri runtime.
- Register new commands in the `generate_handler!` list in `lib.rs`, under the
  matching section comment.

---

## The IPC Boundary

Commands return `AppResult<T>`, never `Result<T, String>`. `AppError` in
`src-tauri/src/error.rs` serializes to `{ code, message, details }`, which is
what `TauriError.fromRust()` in `src/lib/api/errors.ts` parses. If you add a
variant, add the matching code to the `TauriErrorCode` union in the same commit
— the Rust `code()` function is the authority.

On the frontend, never call `invoke` from a component. Add an entry to the
`commands` object in `src/lib/api/tauri-client.ts` and use that. It is the only
place a Rust command name appears in TypeScript.

---

## Credential Handling

The invariant: **the API secret key travels IPC in one direction only.**

- Commands may accept it. No command may return it.
- Reads return `hasSecret` and a four-character hint.
- Never write it to `AppConfig`, `localStorage`, a log line, a saved test case,
  or an exported report.
- Once a save succeeds, clear it from React state.

There are unit tests asserting each half of this in
`src-tauri/src/commands/credentials.rs` and `src-tauri/src/config.rs`. If you
change credential handling and those tests do not need updating, check your
assumptions.

Relatedly: the webview has no network access by design (`withGlobalTauri: false`
and a CSP with no remote hosts). HTTP belongs in Rust. Do not `fetch()` the
Confinaid API from React.

---

## State Management

Three tiers, and they do not overlap:

| Concern                            | Use                                         |
| ---------------------------------- | ------------------------------------------- |
| Anything from Rust                 | TanStack Query, with a key from `queryKeys` |
| Cross-cutting app concerns (theme) | A provider in `src/providers/`              |
| Local UI state (sidebar collapse)  | A zustand slice in `src/stores/`            |

Do not cache command results in zustand. `queryKeys` in
`src/lib/api/query-client.ts` already carries the full eventual hierarchy —
extend it rather than inventing a parallel scheme.

---

## Styling

Tailwind v4, CSS-first. Design tokens live in `:root` and `.dark` in
`src/index.css` as oklch values.

Use the semantic tokens, not raw palette classes: `bg-destructive` for a
failure, `text-success` for a pass, `bg-warning` for a throttle. A hard-coded
`text-green-500` looks right today and is wrong in the other theme.

Every UI change must be checked in both light and dark.

---

## Testing

```bash
pnpm test                 # vitest
pnpm test:coverage
cargo test --workspace --lib
```

Frontend tests live beside the code as `*.test.ts(x)`. `src/__tests__/setup.ts`
mocks every `@tauri-apps/*` module globally — override locally when a test cares
about a specific call.

Rust domain modules are testable without a Tauri runtime; keep them that way.
`SKIP_TAURI_BUILD=1` skips `build.rs`, but `generate_context!()` still needs a
`dist/` directory to exist, which is why CI stubs one.

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
- [ ] `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace --lib` pass.
- [ ] New Rust files carry the SPDX header.
- [ ] New commands are in the `commands` object and `generate_handler!`.
- [ ] No secrets, tokens, or leftover `console.log` in the diff.
- [ ] UI verified in both light and dark themes.
- [ ] Commits follow Conventional Commits.

---

## Licensing of Contributions

This project is licensed under [Apache-2.0](./LICENSE). Under Section 5 of that
license, any contribution you intentionally submit for inclusion is licensed
under the same terms, without any additional conditions. **There is no separate
CLA.**

Please only submit work you have the right to license this way.

By participating you also agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
