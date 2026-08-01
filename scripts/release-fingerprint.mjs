#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "dist/.openai/release-fingerprint.json");
const command = process.argv[2] ?? "check";

function sha256(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function releaseFiles() {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  ).toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const path of paths.sort()) {
    if (path === ".openai/hosting.json") continue;
    const absolute = resolve(root, path);
    try {
      if ((await stat(absolute)).isFile()) files.push(path);
    } catch {
      // A tracked deletion is absent from both the working release and its
      // eventual committed tree, so it contributes no bytes to either digest.
    }
  }
  return files;
}

async function digestFiles(paths) {
  const parts = [];
  for (const path of paths) {
    parts.push(path, "\0", await readFile(resolve(root, path)), "\0");
  }
  return sha256(parts);
}

async function fingerprint() {
  const files = await releaseFiles();
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(root, ".openai/hosting.json"), "utf8"));
  const { project_id: projectId, ...portableManifest } = manifest;
  const migrations = files.filter((path) => path.startsWith("drizzle/"));
  const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return {
    version: packageJson.version,
    sourceSha256: await digestFiles(files),
    lockSha256: sha256([await readFile(resolve(root, "package-lock.json"))]),
    migrationsSha256: await digestFiles(migrations),
    portableManifestSha256: sha256([canonicalJson(portableManifest)]),
    targetManifestSha256: sha256([canonicalJson(manifest)]),
    bindings: { d1: manifest.d1 ?? null, r2: manifest.r2 ?? null },
    targetProjectId: projectId ?? null,
    baseCommit,
  };
}

const current = await fingerprint();
if (command === "write") {
  await writeFile(outputPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Wrote release fingerprint ${current.sourceSha256}`);
} else if (command === "check") {
  const packaged = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(packaged, current, "Packaged release fingerprint is stale");
  assert.deepEqual(packaged.bindings, { d1: "DB", r2: "BUCKET" });
  console.log(`Verified release fingerprint ${current.sourceSha256}`);
} else {
  throw new Error("Use release-fingerprint.mjs write or check.");
}
