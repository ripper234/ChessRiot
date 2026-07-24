#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
const readmePath = resolve(root, "README.md");
const specPath = resolve(root, "SPEC.md");
const changelogPath = resolve(root, "lib/changelog.ts");
const command = process.argv[2] ?? "check";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Expected a stable SemVer version, received "${version}".`);
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Could not find the current version in ${label}.`);
  }
  return source.replace(pattern, replacement);
}

function readGit(args) {
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
  const contents = readGit(["show", `${ref}:package.json`]);
  if (!contents) return null;
  return JSON.parse(contents).version;
}

function checkConsistency(version) {
  const lock = readJson(lockPath);
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    throw new Error("package.json and package-lock.json versions do not match.");
  }

  const readme = readFileSync(readmePath, "utf8");
  const spec = readFileSync(specPath, "utf8");
  if (!readme.includes(`ChessRiot v${version} is`)) {
    throw new Error(`README.md does not identify ChessRiot v${version}.`);
  }
  if (!spec.startsWith(`# ChessRiot v${version} specification`)) {
    throw new Error(`SPEC.md does not identify ChessRiot v${version}.`);
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const versions = [...changelog.matchAll(/^\s+version: "(\d+\.\d+\.\d+)",$/gm)]
    .map((match) => match[1]);
  if (versions[0] !== version) {
    throw new Error(`The newest changelog entry must be ${version}.`);
  }
  if (new Set(versions).size !== versions.length) {
    throw new Error("Changelog versions must be unique.");
  }
  for (let index = 1; index < versions.length; index += 1) {
    if (compareVersions(versions[index - 1], versions[index]) <= 0) {
      throw new Error("Changelog versions must be newest first.");
    }
  }
}

function checkVersion() {
  const version = readJson(packagePath).version;
  parseVersion(version);
  checkConsistency(version);

  const status = readGit(["status", "--porcelain"]);
  const baselineRef = status ? "HEAD" : "HEAD^";
  const baselineVersion = versionAt(baselineRef);
  if (baselineVersion && compareVersions(version, baselineVersion) <= 0) {
    throw new Error(
      `Release version ${version} must be greater than ${baselineVersion}. ` +
        "Run npm run release:patch, or choose release:minor for a new capability.",
    );
  }

  console.log(
    baselineVersion
      ? `Release version verified: ${baselineVersion} → ${version}`
      : `Release version consistency verified: ${version}`,
  );
}

function bumpVersion(kind) {
  if (!["patch", "minor", "major"].includes(kind)) {
    throw new Error("Use check, patch, minor, or major.");
  }

  const packageJson = readJson(packagePath);
  const lock = readJson(lockPath);
  const current = packageJson.version;
  const [major, minor, patch] = parseVersion(current);
  const next =
    kind === "major"
      ? `${major + 1}.0.0`
      : kind === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;

  packageJson.version = next;
  lock.version = next;
  lock.packages[""].version = next;
  writeJson(packagePath, packageJson);
  writeJson(lockPath, lock);

  const readme = readFileSync(readmePath, "utf8");
  const spec = readFileSync(specPath, "utf8");
  writeFileSync(
    readmePath,
    replaceRequired(
      readme,
      /^ChessRiot v\d+\.\d+\.\d+ is/m,
      `ChessRiot v${next} is`,
      "README.md",
    ),
  );
  writeFileSync(
    specPath,
    replaceRequired(
      spec,
      /^# ChessRiot v\d+\.\d+\.\d+ specification/m,
      `# ChessRiot v${next} specification`,
      "SPEC.md",
    ),
  );

  console.log(`${current} → ${next}`);
}

if (command === "check") {
  checkVersion();
} else {
  bumpVersion(command);
}
