#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi
timeout --signal=TERM --kill-after=10s "${SITES_BUILD_TIMEOUT:-3m}" \
  "${SITES_PROJECT_ROOT}/node_modules/.bin/vinext" build
"${script_dir}/validate-artifact.sh"
