#!/usr/bin/env bash
#
# Casper Testnet All-in-One Deploy Script
# Deploys contracts and wires frontend configuration automatically.
#
# Usage: bash casper/scripts/testnet_deploy_and_wire_frontend.sh
#
# Required environment variables:
#   ODRA_CASPER_LIVENET_SECRET_KEY_PATH - path to secret key file
#   ODRA_CASPER_LIVENET_NODE_ADDRESS    - Casper node RPC URL
#   ODRA_CASPER_LIVENET_CHAIN_NAME      - chain name (default: casper-test)
#
# Optional:
#   DEFAULT_VALIDATOR_PUBLIC_KEY  - Validator public key for delegation
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CASPER_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$CASPER_DIR")"
MAGNI_CASPER_DIR="$CASPER_DIR/magni_casper"
FRONTEND_DIR="$CASPER_DIR/frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "  Casper Testnet Deploy + Frontend Wiring"
echo "============================================"
echo ""

# Prefer casper/.env if present so the user doesn't need to export vars manually.
if [[ -f "$CASPER_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CASPER_DIR/.env"
  set +a
fi

# Check required environment variables
check_required_env() {
    local missing=0

    if [[ -z "${ODRA_CASPER_LIVENET_SECRET_KEY_PATH}" ]]; then
        echo -e "${RED}ERROR: ODRA_CASPER_LIVENET_SECRET_KEY_PATH is not set${NC}"
        echo "       Set it to the path of your Casper secret key file"
        missing=1
    fi

    if [[ -z "${ODRA_CASPER_LIVENET_NODE_ADDRESS}" ]]; then
        echo -e "${YELLOW}WARNING: ODRA_CASPER_LIVENET_NODE_ADDRESS not set, using default${NC}"
        export ODRA_CASPER_LIVENET_NODE_ADDRESS="https://node.testnet.casper.network"
    fi

    # Odra appends "/rpc" internally, normalize to base URL (no trailing /rpc).
    if [[ "${ODRA_CASPER_LIVENET_NODE_ADDRESS}" == */rpc ]]; then
        export ODRA_CASPER_LIVENET_NODE_ADDRESS="${ODRA_CASPER_LIVENET_NODE_ADDRESS%/rpc}"
    fi

    if [[ -z "${ODRA_CASPER_LIVENET_EVENTS_URL:-}" ]]; then
        echo -e "${YELLOW}WARNING: ODRA_CASPER_LIVENET_EVENTS_URL not set, using a placeholder${NC}"
        export ODRA_CASPER_LIVENET_EVENTS_URL="https://node.testnet.casper.network/events"
    fi

    if [[ -z "${ODRA_CASPER_LIVENET_CHAIN_NAME}" ]]; then
        echo -e "${YELLOW}WARNING: ODRA_CASPER_LIVENET_CHAIN_NAME not set, using casper-test${NC}"
        export ODRA_CASPER_LIVENET_CHAIN_NAME="casper-test"
    fi

    if [[ $missing -eq 1 ]]; then
        echo ""
        echo "Example usage:"
        echo "  cp casper/.env.example casper/.env"
        echo "  # edit casper/.env"
        echo "  bash casper/scripts/testnet_deploy_and_wire_frontend.sh"
        exit 1
    fi
}

# Run the livenet deploy and capture output
run_deploy() {
    echo "[1/6] Running magni_livenet deploy..."
    echo ""

    cd "$MAGNI_CASPER_DIR"

    cargo odra build

    # Run the livenet binary and capture output
    DEPLOY_OUTPUT=$(MAGNI_LIVENET_MODE=deploy cargo run --bin magni_livenet --features=livenet 2>&1) || {
        echo -e "${RED}ERROR: Deploy failed${NC}"
        echo "$DEPLOY_OUTPUT"
        exit 1
    }

    # Print the output for visibility
    echo "$DEPLOY_OUTPUT"
    echo ""

    # Extract JSON line
    JSON_LINE=$(echo "$DEPLOY_OUTPUT" | grep "^MAGNI_DEPLOY_JSON=" || true)

    if [[ -z "$JSON_LINE" ]]; then
        echo -e "${RED}ERROR: Could not find MAGNI_DEPLOY_JSON in output${NC}"
        echo "       The deploy may have succeeded but JSON output was not generated."
        echo "       Check the output above for contract addresses."
        exit 1
    fi

    # Extract JSON payload (remove prefix)
    DEPLOY_JSON="${JSON_LINE#MAGNI_DEPLOY_JSON=}"
    echo -e "${GREEN}[OK] Deploy JSON captured${NC}"
}

# Parse JSON and extract values
parse_json() {
    echo "[2/6] Parsing deploy results..."

    # Use simple bash parsing (no jq dependency)
    # Extract values using grep/sed
    CHAIN_NAME=$(echo "$DEPLOY_JSON" | sed 's/.*"chain_name":"\([^"]*\)".*/\1/')
    NODE_URL=$(echo "$DEPLOY_JSON" | sed 's/.*"node_url":"\([^"]*\)".*/\1/')
    MCSPR_HASH=$(echo "$DEPLOY_JSON" | sed 's/.*"mcspr_contract_hash":"\([^"]*\)".*/\1/')
    MAGNI_HASH=$(echo "$DEPLOY_JSON" | sed 's/.*"magni_contract_hash":"\([^"]*\)".*/\1/')
    VALIDATOR_KEY=$(echo "$DEPLOY_JSON" | sed 's/.*"validator_public_key":"\([^"]*\)".*/\1/')
    DEPLOYED_AT=$(echo "$DEPLOY_JSON" | sed 's/.*"deployed_at":"\([^"]*\)".*/\1/')

    # Normalize hashes if they include wrapper strings like "Contract(ContractPackageHash(...))".
    normalize_hash() {
        local raw="$1"
        local hex
        hex=$(echo "$raw" | grep -oE '[0-9a-fA-F]{64}' | head -n1 || true)
        if [[ -n "$hex" ]]; then
            echo "$hex"
        else
            echo "$raw"
        fi
    }

    MCSPR_HASH=$(normalize_hash "$MCSPR_HASH")
    MAGNI_HASH=$(normalize_hash "$MAGNI_HASH")

    echo "  Chain: $CHAIN_NAME"
    echo "  Node:  $NODE_URL"
    echo "  mCSPR: $MCSPR_HASH"
    echo "  Magni: $MAGNI_HASH"
    echo "  Validator: $VALIDATOR_KEY"
    echo -e "${GREEN}[OK] JSON parsed${NC}"
}

# Write frontend .env.local
write_env_local() {
    echo "[3/6] Writing frontend/.env.local..."

    cat > "$FRONTEND_DIR/.env.local" << EOF
# Auto-generated by testnet_deploy_and_wire_frontend.sh
# Deployed at: $DEPLOYED_AT

VITE_CASPER_CHAIN_NAME=$CHAIN_NAME
VITE_CASPER_NODE_URL=$NODE_URL
VITE_DEFAULT_VALIDATOR_PUBLIC_KEY=$VALIDATOR_KEY
EOF

    echo -e "${GREEN}[OK] $FRONTEND_DIR/.env.local created${NC}"
}

# Generate contracts.generated.ts
write_contracts_generated() {
    echo "[4/6] Writing frontend/src/config/contracts.generated.ts..."

    mkdir -p "$FRONTEND_DIR/src/config"

    cat > "$FRONTEND_DIR/src/config/contracts.generated.ts" << EOF
// Auto-generated by testnet_deploy_and_wire_frontend.sh
// DO NOT EDIT MANUALLY
// Deployed at: $DEPLOYED_AT

export const generatedConfig = {
  chainName: '$CHAIN_NAME',
  nodeUrl: '$NODE_URL',
  // Deprecated in staking-based version (kept for backwards compatibility).
  tcsprContractHash: '',
  mcsprContractHash: '$MCSPR_HASH',
  magniContractHash: '$MAGNI_HASH',
  defaultValidatorPublicKey: '$VALIDATOR_KEY',
  deployedAt: '$DEPLOYED_AT',
} as const;

export default generatedConfig;
EOF

    echo -e "${GREEN}[OK] $FRONTEND_DIR/src/config/contracts.generated.ts created${NC}"
}

# Update CONTRACTS.md
update_contracts_md() {
    echo "[5/6] Updating casper/CONTRACTS.md..."

    CONTRACTS_MD="$CASPER_DIR/CONTRACTS.md"

    # Create header if file doesn't exist
    if [[ ! -f "$CONTRACTS_MD" ]]; then
        cat > "$CONTRACTS_MD" << 'HEADER'
# Casper Testnet Contract Deployments

This file tracks deployed contract addresses on Casper Testnet.

---

HEADER
    fi

    # Append new deployment entry
    cat >> "$CONTRACTS_MD" << EOF

## Deployment: $DEPLOYED_AT

| Field | Value |
|-------|-------|
| Network | $CHAIN_NAME |
| Node RPC | $NODE_URL |
| mCSPR | \`$MCSPR_HASH\` |
| Magni | \`$MAGNI_HASH\` |
| Validator | \`$VALIDATOR_KEY\` |

---
EOF

    echo -e "${GREEN}[OK] $CONTRACTS_MD updated${NC}"
}

update_vercel_env() {
    echo "[6/6] Updating Vercel env (optional)..."

    if [[ -z "${VERCEL_TOKEN:-}" ]]; then
        echo "  Skipped: VERCEL_TOKEN not set"
        return
    fi

    local project_id="${VERCEL_PROJECT_ID:-${VERCEL_PROJECT:-}}"
    if [[ -z "$project_id" ]]; then
        echo "  Skipped: VERCEL_PROJECT_ID (or VERCEL_PROJECT) not set"
        return
    fi

    local team_q=""
    if [[ -n "${VERCEL_TEAM_ID:-}" ]]; then
        team_q="&teamId=${VERCEL_TEAM_ID}"
    fi

    local api="https://api.vercel.com/v9/projects/${project_id}/env?upsert=1${team_q}"

    upsert_env() {
        local key="$1"
        local value="$2"
        for target in production preview development; do
            curl -sS -X POST "$api" \
                -H "Authorization: Bearer ${VERCEL_TOKEN}" \
                -H "Content-Type: application/json" \
                -d "{\"key\":\"${key}\",\"value\":\"${value}\",\"target\":[\"${target}\"],\"type\":\"encrypted\"}" \
                >/dev/null
        done
    }

    upsert_env "VITE_CASPER_CHAIN_NAME" "$CHAIN_NAME"
    upsert_env "VITE_CASPER_NODE_URL" "$NODE_URL"
    upsert_env "VITE_DEFAULT_VALIDATOR_PUBLIC_KEY" "$VALIDATOR_KEY"

    echo "  Vercel env updated for production/preview/development"
}

# Verify frontend build
verify_frontend_build() {
    echo ""
    echo "[Smoke Test] Verifying frontend build..."

    cd "$REPO_DIR"

    if ! command -v pnpm >/dev/null 2>&1; then
        echo -e "${RED}ERROR: pnpm is not installed${NC}"
        echo "       Install pnpm and re-run."
        exit 1
    fi

    echo "  Installing dependencies (workspace root)..."
    pnpm install 2>&1 || {
        echo -e "${RED}ERROR: pnpm install failed${NC}"
        exit 1
    }

    echo "  Building frontend..."
    pnpm frontend:build 2>&1 || {
        echo -e "${RED}ERROR: Frontend build failed${NC}"
        exit 1
    }

    echo -e "${GREEN}[OK] Frontend build succeeded${NC}"
}

# Main execution
main() {
    check_required_env
    run_deploy
    parse_json
    write_env_local
    write_contracts_generated
    update_contracts_md
    update_vercel_env
    verify_frontend_build

    echo ""
    echo "============================================"
    echo -e "${GREEN}  Deployment and wiring complete!${NC}"
    echo "============================================"
    echo ""
    echo "Next steps:"
    echo "  1. Start frontend: pnpm frontend:dev"
    echo "  2. Connect Casper Wallet"
    echo "  3. Verify contract hash loading in UI"
    echo ""
    echo "Contract hashes:"
    echo "  mCSPR: $MCSPR_HASH"
    echo "  Magni: $MAGNI_HASH"
    echo ""
}

main "$@"
