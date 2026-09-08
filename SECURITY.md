# Security Policy

Confinaid Test Tool holds a Confinaid API secret key and drives traffic against
production and staging APIs. Its security posture matters more than its feature
set, so this document describes both how the tool protects credentials and how
to report a problem with it.

---

## Reporting a Vulnerability

**Do not open a public issue, pull request, or discussion for a security
vulnerability.** Please report it privately so a fix can ship before details
are public.

Two channels, either is fine:

1. **GitHub private vulnerability reporting** (preferred) —
   [open a private advisory](https://github.com/Compuvi/confinaid-test-tool/security/advisories/new).
2. **Email** — `security@compuvi.com`.

Please include:

- A clear description of the issue and its impact.
- Steps to reproduce, with a proof-of-concept where possible.
- Affected version(s) and platform(s).
- Any suggested remediation.

Redact real credentials from anything you attach.

### Response targets

| Stage                         | Target                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| Acknowledgement               | within 2 business days                                      |
| Initial assessment & severity | within 5 business days                                      |
| Fix or mitigation plan        | based on severity (critical issues prioritized immediately) |

We credit reporters in the release notes unless you prefer otherwise. There is
no paid bug bounty at this time.

---

## Supported Versions

| Version        | Supported |
| -------------- | --------- |
| Latest release | ✅ Yes    |
| Older releases | ❌ No     |

Only the most recent release receives security fixes. Update before reporting
an issue you found on an older build.

---

## Security Model

**Credential storage.** The API secret key is written to the OS keychain via
`keyring` v3 native backends — Keychain Services on macOS, Credential Manager
on Windows, Secret Service on Linux. It is never written to `config.json`,
never placed in `localStorage`, and never included in logs.

**Write-only across IPC.** `save_credentials` accepts the secret;
no command returns it. Reads yield `hasSecret` and a four-character hint. The
value therefore never enters the renderer process, so it cannot appear in a
devtools heap snapshot, a React state dump, or a crash report from the webview.
See `src-tauri/src/commands/credentials.rs`, where a unit test asserts the
response type cannot serialize a secret.

**No network from the webview.** The Content Security Policy in
`src-tauri/tauri.conf.json` sets `connect-src 'self' ipc: http://ipc.localhost`
with no remote hosts, and `withGlobalTauri` is `false`. All API traffic goes
through Rust, where the secret already lives.

**Capability model.** A single `src-tauri/capabilities/default.json` grants an
explicitly enumerated permission set to one window. Nothing is granted by
wildcard.

**Report redaction.** Exported reports and saved test cases are redacted of
credential material before they are written. Reports are meant to be shared.

**Supply chain.** `pnpm-workspace.yaml` gates postinstall scripts via
`allowBuilds` and pins security-relevant transitive dependencies with
`overrides`. Dependabot watches npm, cargo, and GitHub Actions. Every
third-party action in `.github/workflows/` is pinned to a full commit SHA.

**Unsigned builds.** Release artifacts are not currently code-signed. On macOS
and Windows this means the OS will warn on first launch, and it means you should
verify you downloaded the artifact from this repository's releases page.

---

## Known Accepted Risks

Advisories that are tracked, understood, and deliberately not fixed. Each is
re-evaluated when its blocking constraint lifts.

| Advisory                                                                    | Component                 | Why it is not fixed                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unsoundness in `glib::VariantStrIter` iterator impls (`< 0.20.0`, moderate) | `glib` 0.18.5, transitive | No upgrade path. `gtk` 0.18.2 — required by Tauri 2.11's Linux webview stack — constrains `glib` to `^0.18`, so the patched 0.20.0 is unreachable. The affected type is never constructed by this crate (there is no direct `glib` usage), and `glib` is only linked on Linux builds. Revisit when Tauri moves to `gtk` 0.19+. |

---

## Scope

In scope: credential handling, the IPC boundary, the CSP and capability
configuration, the release and build pipeline, and dependency supply chain.

Out of scope: vulnerabilities in the Confinaid API itself (report those through
Confinaid's own channels), and issues that require an already-compromised host
with an unlocked keychain.

---

_For licensing terms, see [`LICENSE`](./LICENSE)._
