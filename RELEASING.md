# Releasing Confinaid Test Tool

Two pipelines, driven by different triggers.

---

## How a version is decided

`semantic-release` reads the Conventional Commit messages since the last tag and
computes the next version. `feat` gives a minor, `fix` and `perf` give a patch,
a `!` or `BREAKING CHANGE:` footer gives a major. Everything else releases
nothing.

The version is written to exactly four places, all automatically:

| File                        | Written by                                                        |
| --------------------------- | ----------------------------------------------------------------- |
| `package.json`              | `@semantic-release/npm` (`npmPublish: false`)                     |
| `src-tauri/Cargo.toml`      | `scripts/sync-version.mjs`                                        |
| `Cargo.lock`                | `scripts/sync-version.mjs` (`cargo update --workspace --offline`) |
| `src-tauri/tauri.conf.json` | Nothing — it reads `"version": "../package.json"` at build time   |

`sync-version.mjs` scopes its rewrite to the `[package]` section and exits
non-zero if it cannot find the version line, rather than silently doing nothing.
You can dry-run it:

```bash
node scripts/sync-version.mjs 9.9.9
git diff --stat          # expect exactly Cargo.lock and src-tauri/Cargo.toml
git checkout -- src-tauri/Cargo.toml Cargo.lock
```

---

## Cutting a release

### 1. Merge to `main`

`.github/workflows/release.yml` runs `semantic-release`, which updates
`CHANGELOG.md`, commits `chore(release): x.y.z [skip ci]`, tags `vx.y.z`, and
creates the GitHub release.

The workflow checks out with `PR_CREATOR_TOKEN` rather than `GITHUB_TOKEN`
specifically so the tag it pushes can trigger the build workflow — a
`GITHUB_TOKEN` push cannot start another workflow.

### 2. Installers build from the tag

`.github/workflows/build.yml` fires on `v*` and produces:

| Platform | Artifacts                         |
| -------- | --------------------------------- |
| Windows  | `.msi`, `-setup.exe` (NSIS)       |
| macOS    | `.dmg`, `.app` (universal binary) |
| Linux    | `.AppImage`, `.deb`               |

They are attached to the release created in step 1.

### Rebuilding without a new version

Use the workflow's `workflow_dispatch` trigger and pass the existing tag.

---

## Code signing — not yet

Artifacts are **unsigned**. macOS Gatekeeper will refuse the first launch until
the user right-clicks → Open, and Windows SmartScreen will warn.

Fixing this needs things that do not exist for this repository yet:

- An Apple Developer ID certificate, an `entitlements.plist`, and notarization
  credentials (`APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`).
- A Windows code-signing certificate.

Once those exist, signing and an updater channel scheme should land together —
a signed build without a matching updater public key is not much use.

---

## Repository setup checklist

One-time, in repository settings:

- [ ] Add `PR_CREATOR_TOKEN` to Actions secrets. Without it `release.yml` fails
      on its first run.
- [ ] Enable private vulnerability reporting (Settings → Security), so the link
      in `SECURITY.md` resolves.
- [ ] Enable branch protection on `main` requiring the four CI checks:
      `Frontend`, `Rust (ubuntu-22.04)`, `Rust (macos-latest)`,
      `Rust (windows-latest)`.
- [ ] Tag `v0.1.0` on `main` before the first merge that would trigger a
      release, so `semantic-release` continues in `0.x` instead of cutting
      `1.0.0`.
