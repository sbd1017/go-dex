#!/bin/bash
# Local development: http://127.0.0.1:${1:-8782}/dex/  (public view)  and  /dex/admin  (editing, no login in dev)
# Uses var-dev/ so it never touches a real collection. Seed demo data with: scripts/dev.sh --seed
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8782
if [[ "${1:-}" == "--seed" ]]; then SEED=1; shift; fi
[[ -n "${1:-}" ]] && PORT="$1"
export DEX_AUTH=none DEX_DATA_DIR=var-dev DEX_SECURE_COOKIES=0 DEX_HOST=127.0.0.1 DEX_PORT="$PORT"
[[ -x .venv/bin/python ]] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements-dev.txt; }
.venv/bin/python -m godex.cli init >/dev/null
[[ -n "${SEED:-}" ]] && .venv/bin/python scripts/demo_data.py
exec .venv/bin/python -m godex.serve
