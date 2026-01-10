#!/usr/bin/env bash
set -euo pipefail

echo "=== Magni Casper Setup ==="

# Check rustup
rustup show >/dev/null 2>&1 || { echo "Install rustup first: https://rustup.rs"; exit 1; }

# Install nightly toolchain (required by Odra macros)
echo "Installing nightly toolchain..."
rustup toolchain install nightly-2025-01-05
rustup target add wasm32-unknown-unknown --toolchain nightly-2025-01-05

# Install cargo-odra
if ! command -v cargo-odra >/dev/null 2>&1; then
  echo "Installing cargo-odra..."
  cargo install cargo-odra
fi

# Install wasm tools (required for optimization)
if ! command -v wasm-opt >/dev/null 2>&1; then
  echo "wasm-opt not found. Install binaryen: brew install binaryen (mac) or apt install binaryen (linux)"
fi

if ! command -v wasm-strip >/dev/null 2>&1; then
  echo "wasm-strip not found. Install wabt: brew install wabt (mac) or apt install wabt (linux)"
fi

# Optional: casper-client
if ! command -v casper-client >/dev/null 2>&1; then
  echo "Installing casper-client (optional)..."
  cargo install casper-client || echo "casper-client install failed, skipping (optional)"
fi

echo "=== Setup complete ==="
