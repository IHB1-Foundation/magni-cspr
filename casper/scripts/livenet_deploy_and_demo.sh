#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/magni_casper"

if [ ! -f "$ROOT/.env" ]; then
  echo "Missing $ROOT/.env. Copy from $ROOT/.env.example and fill values."
  exit 1
fi

set -a
source "$ROOT/.env"
set +a

cargo odra build
MAGNI_LIVENET_MODE="${MAGNI_LIVENET_MODE:-deploy_and_demo}" \
  cargo run --bin magni_livenet --features=livenet
