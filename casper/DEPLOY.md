# Deploy (Casper Testnet) — All-in-one Script

This document describes a copy/paste-friendly procedure to deploy the **staking-based** `mCSPR` / `Magni` contracts to Casper Testnet, automatically wire the addresses into the frontend (`casper/frontend`), and append a record to `casper/CONTRACTS.md`.

## 0) Prerequisites

- **Casper Testnet CSPR** (for deploy fees)
- **Secret key file** (`secret_key.pem`) path
- **Node RPC URL**
  - Recommended: `https://node.testnet.casper.network` (note: do not append `/rpc` — Odra appends `/rpc` internally)
- **Events URL** (Odra requirement)
  - `ODRA_CASPER_LIVENET_EVENTS_URL` is currently enforced by Odra as a required env var.
  - This repo does not consume the event stream directly (as of `odra-casper-rpc-client` 2.4.0), so any reachable URL string works.
- (Optional) **Default validator public key**
  - Used for delegate-stake guidance.

## 1) (One-time) Install local dev tooling

```bash
# Install Rust / Odra / wasm toolchain
bash casper/scripts/setup.sh
```

`setup.sh` installs (or guides you to install):
- `rustup` (required)
- `nightly-2025-01-05` + `wasm32-unknown-unknown`
- `cargo-odra`
- (Optional) `casper-client`
- (Recommended) `wasm-opt` (binaryen), `wasm-strip` (wabt)

## 2) (One-time) Generate keys (`secret_key.pem`)

If you already have a key for testnet deployments, you can skip this step.

```bash
# If casper-client is missing, setup.sh can attempt to install it (optional)
command -v casper-client >/dev/null || cargo install casper-client

# Generate keypair under keys/
mkdir -p keys
casper-client keygen keys

# Verify generated files
ls -la keys
# keys/secret_key.pem should exist
```

## 3) (Required) Set deploy environment variables

### Option A) Manage via `casper/.env` (recommended)

```bash
cp casper/.env.example casper/.env
```

Open `casper/.env` and fill in:

```bash
# ---- Casper Testnet (Odra Livenet) ----
ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/ABS/PATH/to/secret_key.pem
ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.casper.network
ODRA_CASPER_LIVENET_EVENTS_URL=https://node.testnet.casper.network/events
ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test

# Payment limits (motes). 1 CSPR = 1_000_000_000 motes.
# NOTE (Casper 2.0): payment is held ("gas hold") for a period (testnet currently: 24h),
# so setting this too high can temporarily lock your whole balance.
# NOTE: testnet block gas limit is 812_500_000_000 — if you set above this you'll get "exceeds the networks block gas limit".
ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN=450_000_000_000
ODRA_CASPER_LIVENET_DEPLOY_GAS_MAGNI=600_000_000_000
ODRA_CASPER_LIVENET_CALL_GAS=50_000_000_000

# Legacy fallback (used if per-step vars above are missing)
ODRA_CASPER_LIVENET_GAS=450_000_000_000

# ---- Default validator (optional) ----
DEFAULT_VALIDATOR_PUBLIC_KEY=012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80
```

Load the env before running scripts:

```bash
set -a
source casper/.env
set +a
```

### Option B) Export directly in your terminal

```bash
export ODRA_CASPER_LIVENET_SECRET_KEY_PATH="/ABS/PATH/to/secret_key.pem"
export ODRA_CASPER_LIVENET_NODE_ADDRESS="https://node.testnet.casper.network"
export ODRA_CASPER_LIVENET_CHAIN_NAME="casper-test"
export ODRA_CASPER_LIVENET_EVENTS_URL="https://node.testnet.casper.network/events"

export ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN="450_000_000_000"
export ODRA_CASPER_LIVENET_DEPLOY_GAS_MAGNI="600_000_000_000"
export ODRA_CASPER_LIVENET_CALL_GAS="50_000_000_000"
export ODRA_CASPER_LIVENET_GAS="450_000_000_000"

export DEFAULT_VALIDATOR_PUBLIC_KEY="012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80"
```

## 4) (Required) Deploy contracts + wire frontend + append deployment record

```bash
bash casper/scripts/testnet_deploy_and_wire_frontend.sh
```

This script performs the following in one run:
- Builds wasm via `cargo odra build`
- Deploys via `MAGNI_LIVENET_MODE=deploy cargo run --bin magni_livenet --features=livenet` (skips demo transactions)
- Parses the deploy output (JSON)
- Auto-creates/updates frontend config:
  - `casper/frontend/.env.local`
  - `casper/frontend/src/config/contracts.generated.ts`
- Appends deployment info to `casper/CONTRACTS.md`
- Runs a smoke check to ensure the frontend build still succeeds:
  - `pnpm install`
  - `pnpm frontend:build`

## 5) Run frontend & manual smoke test (recommended)

```bash
pnpm frontend:dev
```

Verify in the browser:
- Default dev URL: `http://127.0.0.1:5173`
- Contract hashes are loaded in the Contracts section
- After connecting Casper Wallet, transaction buttons are enabled
- (E2E) Verify the flow:
  - deposit → borrow → (mCSPR approve) → repay → request_withdraw → finalize_withdraw
  - Note: `finalize_withdraw()` can fail before unbonding completes.

CEP-18 check (explorer):
- After a successful `borrow`, the mCSPR balance should appear under the account’s **Tokens** tab on `cspr.live`.
- If it doesn’t, open the mCSPR contract package page and confirm CEP-18 metadata (name/symbol/decimals/total_supply) is visible.

## 6) Where to check outputs (files)

- Latest deployment record: `casper/CONTRACTS.md`
- Frontend env: `casper/frontend/.env.local`
- Frontend constants: `casper/frontend/src/config/contracts.generated.ts`

## 7) (Recommended) Host the frontend (Vercel) — avoid CORS via `/rpc` proxy

Casper node RPC endpoints (`https://node.*.casper.network/rpc`) often do not provide CORS headers, so browser calls can fail with `Failed to fetch`, causing **balance queries / deploy submissions to fail**.

This repo includes the following for Vercel hosting:
- `casper/frontend/api/rpc.js`: serverless JSON-RPC proxy
- `casper/frontend/vercel.json`: `/rpc` → `/api/rpc` rewrite

So the frontend always calls **same-origin** `POST /rpc`, and Vercel forwards requests server-side to the Casper node.

### 7.1) Vercel project settings

When creating a new Vercel project:
- **Root Directory**: `casper/frontend`
- **Install Command**: `pnpm install`
- **Build Command**: `pnpm build`
- **Output Directory**: `dist`

### 7.2) Vercel env vars (required)

Vercel Project → Settings → Environment Variables:

```bash
# Casper node JSON-RPC upstream (recommended: testnet)
CASPER_NODE_RPC_URL=https://node.testnet.casper.network/rpc
```

To switch to mainnet:

```bash
CASPER_NODE_RPC_URL=https://node.mainnet.casper.network/rpc
```

### 7.3) About frontend config values (`VITE_*`)

Vite `import.meta.env.VITE_*` values are injected **at build time only**.

This repo uses `casper/frontend/src/config/contracts.generated.ts` as a fallback, so the simplest operational flow is:
- Deploy via the script (`testnet_deploy_and_wire_frontend.sh`) so `contracts.generated.ts` is updated, then build/deploy the frontend.

Alternatively, you can provide these directly in Vercel as `VITE_*` env vars:
- `VITE_CASPER_CHAIN_NAME`
- `VITE_CASPER_NODE_URL` (recommended: empty or `/rpc` — same-origin proxy)
- `VITE_MCSPR_CONTRACT_HASH`
- `VITE_MAGNI_CONTRACT_HASH`
- `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY`

## (Optional) Redeploy Magni only (reuse existing token deployments)

If `mCSPR` is already deployed (e.g. an earlier run failed mid-way due to gas-hold), and you want to reuse token contracts and redeploy only `Magni`:

```bash
# Add to casper/.env (supports 64-hex, or hash-..., contract-package-... formats)
MAGNI_EXISTING_MCSPR=<mcspr_contract_hash_hex>
```

Then rerun:

```bash
bash casper/scripts/testnet_deploy_and_wire_frontend.sh
```

## Troubleshooting

### RPC 401 error
- This repo’s default RPC is `https://node.testnet.casper.network`.
- If you use a different RPC, note that Odra appends `/rpc` to the base URL, so do not include `/rpc` yourself.

### "exceeds the networks block gas limit"
- `ODRA_CASPER_LIVENET_*_GAS` values are too high.
- Testnet `transactions.block_gas_limit` is `812_500_000_000` (motes).

### "Insufficient funds" (especially after deploying 2 token contracts)
- Due to Casper 2.0 gas-hold, **each transaction’s payment limit can be locked for a period (currently 24h on testnet)**.
- Fixes:
  - top up testnet CSPR via faucet, or
  - reduce `ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN / _MAGNI / _CALL_GAS` as much as possible.

### Frontend shows empty contract hashes
- Verify the script succeeded, and ensure these files were created/updated:
  - `casper/frontend/.env.local`
  - `casper/frontend/src/config/contracts.generated.ts`

### withdraw/finalize fails
- The V2 vault uses a 2-step flow: `request_withdraw(amount_motes)` → (unbonding delay) → `finalize_withdraw()`.
- `finalize_withdraw()` can fail before unbonding completes (insufficient liquid balance in the contract).
- `request_withdraw()` must keep LTV (80%) safe after the withdrawal; if you request too much while debt is large, the contract will revert.
