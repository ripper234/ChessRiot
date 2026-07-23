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
node --input-type=module - "${worker}" "${hosting}" <<'NODE'
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const [workerPath, hostingPath] = process.argv.slice(2);
JSON.parse(await readFile(hostingPath, "utf8"));
const url = pathToFileURL(workerPath);
url.searchParams.set("check", `${process.pid}-${Date.now()}`);
const worker = await import(url.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("Worker must export default.fetch");
}
NODE
echo "Validated Sites artifact"
