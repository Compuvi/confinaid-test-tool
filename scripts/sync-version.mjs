#!/usr/bin/env node
/**
 * sync-version — propagate the semantic-release version into the Rust crate.
 *
 * @semantic-release/npm writes package.json, and src-tauri/tauri.conf.json
 * reads its version from there ("version": "../package.json"). Only Cargo is
 * left, and it needs two files kept in step:
 *
 *   1. src-tauri/Cargo.toml  — the [package] version line
 *   2. Cargo.lock            — refreshed, so the release commit is
 *                              self-consistent and the next CI run does not
 *                              start with a dirty tree
 *
 * This replaces the inline `node -e` one-liner used in confinaid-desktop,
 * whose /^version = "..."/m regex matched the first `version =` anywhere in
 * the file — including a dependency's, once one is written across two lines.
 * Here the replacement is scoped to the [package] section, and a miss is a
 * hard failure: silently doing nothing would ship a mis-versioned binary.
 *
 * Usage:
 *   node scripts/sync-version.mjs 1.2.3
 *
 * Zero dependencies (Node 18+).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARGO_TOML = join(ROOT, "src-tauri", "Cargo.toml");

function fail(message) {
  console.error(`✗ sync-version: ${message}`);
  process.exit(1);
}

const version = process.argv[2];
if (!version) fail("missing version argument (usage: sync-version.mjs 1.2.3)");
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) fail(`"${version}" is not a semver version`);

const original = readFileSync(CARGO_TOML, "utf8");

// Slice out [package] only — up to the next top-level table header.
const packageStart = original.indexOf("[package]");
if (packageStart === -1) fail(`no [package] section in ${CARGO_TOML}`);

const afterHeader = packageStart + "[package]".length;
const nextTable = original.indexOf("\n[", afterHeader);
const packageEnd = nextTable === -1 ? original.length : nextTable;

const packageSection = original.slice(packageStart, packageEnd);
const versionLine = /^version\s*=\s*"[^"]*"/m;
if (!versionLine.test(packageSection)) fail("no version line inside the [package] section");

const updated =
  original.slice(0, packageStart) +
  packageSection.replace(versionLine, `version = "${version}"`) +
  original.slice(packageEnd);

if (updated === original) {
  console.log(`» sync-version: src-tauri/Cargo.toml already at ${version}`);
} else {
  writeFileSync(CARGO_TOML, updated);
  console.log(`» sync-version: src-tauri/Cargo.toml → ${version}`);
}

// --offline: the lockfile only needs this crate's own version bumped, and a
// release must not silently pick up new dependency versions from the network.
execFileSync("cargo", ["update", "--workspace", "--offline"], {
  cwd: ROOT,
  stdio: "inherit",
});
console.log("» sync-version: Cargo.lock refreshed");
