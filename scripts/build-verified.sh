#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi
"${SITES_PROJECT_ROOT}/node_modules/.bin/eslint" . --ignore-pattern dist --ignore-pattern .next
"${SITES_PROJECT_ROOT}/node_modules/.bin/tsc" --noEmit
"${SITES_PROJECT_ROOT}/node_modules/.bin/vitest" run --maxWorkers=2
"${script_dir}/build-artifact.sh"
node --test "${SITES_PROJECT_ROOT}/tests/rendered-html.test.mjs"
node "${SITES_PROJECT_ROOT}/tests/e2e-local.mjs"
