#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi
worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"
test -f "${worker}" || { echo "Missing Sites Worker entry" >&2; exit 66; }
test -f "${hosting}" || { echo "Missing packaged Sites manifest" >&2; exit 66; }
node --input-type=module - "${worker}" "${hosting}" "${SITES_PROJECT_ROOT}/dist" <<'NODE'
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const [workerPath, hostingPath, distPath] = process.argv.slice(2);
JSON.parse(await readFile(hostingPath, "utf8"));
const url = pathToFileURL(workerPath);
url.searchParams.set("check", `${process.pid}-${Date.now()}`);
const worker = await import(url.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("Worker must export default.fetch");
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
  "SIGN IN TO PLAY",
  "SIGN IN",
  "Sign in",
  "sign in",
  "sign-in",
  "Sign in to continue",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
];

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
      throw new Error(`Retired human-check marker "${marker}" remains in ${path}.`);
    }
  }
}
NODE
echo "Validated Sites artifact"
