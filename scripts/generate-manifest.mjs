#!/usr/bin/env node
/**
 * generate-manifest.mjs
 *
 * Generates `update-manifest.json` and uploads it to a GitHub Release.
 *
 * Usage (called by build.yml after all platform artifacts are uploaded):
 *   node scripts/generate-manifest.mjs <version> <release_id>
 *
 * Required environment variables:
 *   GITHUB_TOKEN   — fine-grained PAT or GITHUB_TOKEN from Actions context
 *   GITHUB_REPO    — "owner/repo" (default: Compuvi/confinaid-test-tool)
 */

import { createReadStream, writeFileSync, unlinkSync } from "node:fs";
import { Readable } from "node:stream";

const REPO = process.env.GITHUB_REPO ?? "Compuvi/confinaid-test-tool";
const API = `https://api.github.com/repos/${REPO}`;
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error("[manifest] GITHUB_TOKEN is not set");
  process.exit(1);
}

const [, , version, releaseId] = process.argv;
if (!version || !releaseId) {
  console.error("Usage: node generate-manifest.mjs <version> <release_id>");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Confinaid-Manifest-Generator/1.0",
  "Content-Type": "application/json",
};

// ─── Fetch release assets ────────────────────────────────────────────────────

console.log(`[manifest] Fetching assets for release ${releaseId}…`);

const assetsRes = await fetch(`${API}/releases/${releaseId}/assets?per_page=100`, { headers });
if (!assetsRes.ok) {
  console.error(`[manifest] Failed to fetch assets: HTTP ${assetsRes.status}`);
  process.exit(1);
}
const assets = await assetsRes.json();

/** Find an asset matching a glob-like pattern and extract its metadata. */
function findAsset(pattern) {
  const re = new RegExp(pattern.replace(/\./g, "\\.").replace(/\*/g, ".*"));
  const asset = assets.find((a) => re.test(a.name));
  if (!asset) {
    console.warn(`[manifest] No asset matched pattern: ${pattern}`);
    return null;
  }
  // GitHub provides sha256 in the `digest` field as "sha256:<hex>"
  const checksum = asset.digest?.replace(/^sha256:/, "") ?? "";
  return {
    url: asset.browser_download_url,
    checksum,
    size: asset.size,
    filename: asset.name,
  };
}

// ─── Build manifest ──────────────────────────────────────────────────────────

// Asset name patterns for each platform (version embedded in filenames).
// Confinaid Test Tool uses dots in artifact names from GitHub uploads.
const v = version.replace(/^v/, ""); // strip leading "v" if present

const manifest = {
  schema_version: 1,
  version: v,
  channel: "stable",
  release_date: new Date().toISOString(),
  release_notes: null,
  min_version: null,
  assets: {
    "windows-x86_64": findAsset(`*_${v}_x64-setup.exe`),
    "windows-msi": findAsset(`*_${v}_x64_en-US.msi`),
    "macos-x86_64": findAsset(`*_${v}_universal.dmg`),
    "macos-aarch64": findAsset(`*_${v}_universal.dmg`), // same universal binary
    "linux-x86_64": findAsset(`*_${v}_amd64.AppImage`),
  },
  mandatory: false,
};

// Remove null asset entries so the manifest is clean.
for (const key of Object.keys(manifest.assets)) {
  if (!manifest.assets[key]) delete manifest.assets[key];
}

const manifestJson = JSON.stringify(manifest, null, 2);
console.log("[manifest] Generated manifest:\n" + manifestJson);

// ─── Delete existing update-manifest.json (if any) ──────────────────────────

const existingManifest = assets.find((a) => a.name === "update-manifest.json");
if (existingManifest) {
  console.log("[manifest] Deleting existing update-manifest.json…");
  const delRes = await fetch(`${API}/releases/assets/${existingManifest.id}`, {
    method: "DELETE",
    headers,
  });
  if (!delRes.ok) {
    console.warn(`[manifest] Could not delete existing asset: HTTP ${delRes.status}`);
  }
}

// ─── Upload update-manifest.json to the release ──────────────────────────────

console.log("[manifest] Uploading update-manifest.json…");

// GitHub upload uses a different hostname.
const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets?name=update-manifest.json`;
const body = Buffer.from(manifestJson, "utf-8");

const uploadRes = await fetch(uploadUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Confinaid-Manifest-Generator/1.0",
    "Content-Type": "application/json",
    "Content-Length": String(body.byteLength),
  },
  body,
});

if (!uploadRes.ok) {
  const text = await uploadRes.text().catch(() => "");
  console.error(`[manifest] Upload failed: HTTP ${uploadRes.status}\n${text}`);
  process.exit(1);
}

const uploaded = await uploadRes.json();
console.log(`[manifest] Uploaded: ${uploaded.browser_download_url}`);
