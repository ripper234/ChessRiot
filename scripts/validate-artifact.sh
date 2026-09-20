#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi
worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
wrangler="${SITES_PROJECT_ROOT}/dist/server/wrangler.json"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"
test -f "${worker}" || { echo "Missing Sites Worker entry" >&2; exit 66; }
test -f "${wrangler}" || { echo "Missing generated Worker configuration" >&2; exit 66; }
test -f "${hosting}" || { echo "Missing packaged Sites manifest" >&2; exit 66; }
test -d "${SITES_PROJECT_ROOT}/dist/.openai/drizzle" || { echo "Missing packaged D1 migrations" >&2; exit 66; }
test -f "${SITES_PROJECT_ROOT}/dist/.openai/release-fingerprint.json" || { echo "Missing release fingerprint" >&2; exit 66; }
cmp --silent "${SITES_PROJECT_ROOT}/.openai/hosting.json" "${hosting}" || {
  echo "Packaged Sites manifest differs from source" >&2; exit 66;
}
diff --brief --recursive \
  "${SITES_PROJECT_ROOT}/drizzle" \
  "${SITES_PROJECT_ROOT}/dist/.openai/drizzle" >/dev/null || {
  echo "Packaged D1 migrations differ from source" >&2; exit 66;
}
node "${script_dir}/release-fingerprint.mjs" check
node --input-type=module - "${worker}" "${wrangler}" "${hosting}" "${SITES_PROJECT_ROOT}/dist" <<'NODE'
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const [workerPath, wranglerPath, hostingPath, distPath] = process.argv.slice(2);
JSON.parse(await readFile(hostingPath, "utf8"));
JSON.parse(await readFile(wranglerPath, "utf8"));
const url = pathToFileURL(workerPath);
url.searchParams.set("check", `${process.pid}-${Date.now()}`);
const worker = await import(url.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("Worker must export default.fetch");
}
if (typeof worker.default.scheduled !== "function") {
  throw new Error("Worker must export default.scheduled for push retries.");
}

const forbiddenRuntimeMarkers = [
  "challenges.cloudflare.com/turnstile",
  "cf-turnstile-response",
  "chessriot_login",
  "/api/auth/captcha",
  "__Host-chessriot-access",
  "__CHESSRIOT_TURNSTILE",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "SESSION_SIGNING_SECRET",
  "That check expired or failed",
  "You can play as a guest",
  "Your display name",
  "Add this game to my account",
  "/account-link",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
];

const requiredAccountMarkers = [
  "Sign in and play",
  "Continue with Google",
  "Choose a username",
  "/api/auth/google/start",
  "/api/me/username",
  "View game history",
];
const foundAccountMarkers = new Set();

async function textArtifacts(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await textArtifacts(path));
    else if (/\.(?:css|html|js|json|mjs)$/.test(entry.name)) paths.push(path);
  }
  return paths;
}

for (const path of await textArtifacts(distPath)) {
  const source = await readFile(path, "utf8");
  for (const marker of forbiddenRuntimeMarkers) {
    if (source.includes(marker)) {
      throw new Error(`Retired access marker "${marker}" remains in ${path}.`);
    }
  }
  for (const marker of requiredAccountMarkers) {
    if (source.includes(marker)) foundAccountMarkers.add(marker);
  }
}

for (const marker of requiredAccountMarkers) {
  if (!foundAccountMarkers.has(marker)) {
    throw new Error(`Required account marker "${marker}" is missing from the artifact.`);
  }
}
NODE
echo "Validated Sites artifact"
