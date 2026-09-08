#!/usr/bin/env node
/**
 * sync-version — propagate the semantic-release version into the Rust crate.
 *
 * @semantic-release/npm writes package.json, and src-tauri/tauri.conf.json
 * reads its version from there ("version": "../package.json"). Only Cargo is
 * left, and it needs two files kept in step:
 *
 *   1. src-tauri/Cargo.toml  — the [package] version line
 *   2. Cargo.lock            — the [[package]] entry for this crate, so the
 *                              release commit is self-consistent and the next
 *                              CI run does not start with a dirty tree
 *
 * Both edits are narrowly scoped and a miss is a hard failure: silently doing
 * nothing would ship a mis-versioned binary. (confinaid-desktop used an inline
 * `node -e` whose /^version = "..."/m matched the first `version =` anywhere
 * in the file — including a dependency's.)
 *
 * Cargo.lock is edited directly rather than regenerated via
 * `cargo update --workspace`. Two reasons, the first learned in production:
 *
 *   - `--offline` fails outright on a clean CI runner. There is no populated
 *     registry cache to resolve against, so cargo reports "no matching package
 *     named `keyring` found" and exits 101, taking the release with it.
 *   - Dropping `--offline` would work, but it makes the release job depend on
 *     a Rust toolchain and a crates.io index fetch in order to rewrite what is
 *     ultimately a single version string.
 *
 * The result is byte-identical to `cargo update --workspace`; the test in
 * scripts/sync-version.test.mjs asserts the exact output shape.
 *
 * Usage:
 *   node scripts/sync-version.mjs 1.2.3
 *
 * Zero dependencies (Node 18+). Requires no Rust toolchain.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CRATE_NAME = "confinaid-test-tool";

const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;
const VERSION_LINE = /^version\s*=\s*"[^"]*"/m;

export class SyncVersionError extends Error {}

const bail = (message) => {
  throw new SyncVersionError(message);
};

/** Rewrite the version inside Cargo.toml's `[package]` table only. */
export function bumpPackageVersion(toml, version) {
  if (!SEMVER.test(version)) bail(`"${version}" is not a semver version`);

  const start = toml.indexOf("[package]");
  if (start === -1) bail("no [package] section in Cargo.toml");

  // Stop at the next top-level table so a dependency's version is never hit.
  const nextTable = toml.indexOf("\n[", start + "[package]".length);
  const end = nextTable === -1 ? toml.length : nextTable;
  const section = toml.slice(start, end);

  if (!VERSION_LINE.test(section)) bail("no version line inside the [package] section");

  return (
    toml.slice(0, start) + section.replace(VERSION_LINE, `version = "${version}"`) + toml.slice(end)
  );
}

/** Rewrite the version of a single `[[package]]` entry in Cargo.lock. */
export function bumpLockVersion(lock, crateName, version) {
  if (!SEMVER.test(version)) bail(`"${version}" is not a semver version`);

  // Anchor on the exact name line: a dependency sharing a version string, or a
  // crate whose name is a prefix of ours, must not match.
  const anchor = `\n[[package]]\nname = "${crateName}"\n`;
  const at = lock.indexOf(anchor);
  if (at === -1) bail(`no [[package]] entry named "${crateName}" in Cargo.lock`);

  const start = at + anchor.length;
  const nextEntry = lock.indexOf("\n[[package]]", start);
  const end = nextEntry === -1 ? lock.length : nextEntry;
  const entry = lock.slice(start, end);

  if (!VERSION_LINE.test(entry)) bail(`no version line in the "${crateName}" lock entry`);

  return (
    lock.slice(0, start) + entry.replace(VERSION_LINE, `version = "${version}"`) + lock.slice(end)
  );
}

function main(version) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const targets = [
    {
      path: join(root, "src-tauri", "Cargo.toml"),
      label: "src-tauri/Cargo.toml",
      fn: (t) => bumpPackageVersion(t, version),
    },
    {
      path: join(root, "Cargo.lock"),
      label: "Cargo.lock",
      fn: (t) => bumpLockVersion(t, CRATE_NAME, version),
    },
  ];

  if (!version) bail("missing version argument (usage: sync-version.mjs 1.2.3)");

  for (const { path, label, fn } of targets) {
    const before = readFileSync(path, "utf8");
    const after = fn(before);
    if (after === before) {
      console.log(`» sync-version: ${label} already at ${version}`);
      continue;
    }
    writeFileSync(path, after);
    console.log(`» sync-version: ${label} → ${version}`);
  }
}

// Only run as a CLI, so the test file can import the pure functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(`✗ sync-version: ${error.message}`);
    process.exit(1);
  }
}
