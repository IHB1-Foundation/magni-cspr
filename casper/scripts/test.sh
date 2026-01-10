#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../magni_casper"
cargo odra test
