#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");
const workerPath = resolve(root, "worker/index.js");
const command = process.argv[2] ?? "check";

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid SemVer "${version}".`);
  return match.slice(1).map(Number);
}

function compare(left, right) {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function versionAt(ref) {
  const source = git(["show", `${ref}:package.json`]);
  return source ? JSON.parse(source).version : null;
}

function readCurrent() {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
  const worker = readFileSync(workerPath, "utf8");
  const embedded = /const CONTROL_VERSION = "(\d+\.\d+\.\d+)"/.exec(worker)?.[1];
  if (packageJson.version !== embedded) {
    throw new Error("package.json and CONTROL_VERSION do not match.");
  }
  if (
    packageLock.version !== packageJson.version ||
    packageLock.packages?.[""]?.version !== packageJson.version
  ) {
    throw new Error("package.json and package-lock.json versions do not match.");
  }
  return { packageJson, packageLock, worker, version: packageJson.version };
}

if (command === "check") {
  const { version } = readCurrent();
  const status = git(["status", "--porcelain"]);
  const baseline = versionAt(status ? "HEAD" : "HEAD^");
  if (baseline && compare(version, baseline) <= 0) {
    throw new Error(`Control ${version} must be greater than ${baseline}.`);
  }
  console.log(baseline ? `Control version verified: ${baseline} → ${version}` : `Control version verified: ${version}`);
} else if (["patch", "minor", "major"].includes(command)) {
  const { packageJson, packageLock, worker, version } = readCurrent();
  const [major, minor, patch] = parse(version);
  const next = command === "major"
    ? `${major + 1}.0.0`
    : command === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  packageJson.version = next;
  packageLock.version = next;
  packageLock.packages[""].version = next;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
  writeFileSync(
    workerPath,
    worker.replace(
      /const CONTROL_VERSION = "\d+\.\d+\.\d+"/,
      `const CONTROL_VERSION = "${next}"`,
    ),
  );
  console.log(`${version} → ${next}`);
} else {
  throw new Error("Use check, patch, minor, or major.");
}
