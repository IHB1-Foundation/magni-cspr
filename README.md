# Magni Protocol - Casper Network

Leverage staking protocol on Casper Network. Deposit collateral, borrow against it with up to 5x leverage, and earn staking rewards.

## Architecture

```
magni-casper/
├── casper/
│   ├── magni_casper/     # Odra smart contracts (Rust/WASM)
│   │   ├── src/
│   │   │   ├── tokens.rs     # tCSPR (faucet) + mCSPR (debt token)
│   │   │   ├── magni.rs      # Core lending/borrowing logic
│   │   │   └── styks_external.rs  # Styks oracle interface
│   │   └── wasm/             # Compiled WASM contracts
│   └── frontend/         # React dApp (Vite + TypeScript)
└── package.json          # Workspace root
```

## Key Parameters

| Parameter | Value |
|-----------|-------|
| LTV (Loan-to-Value) | 80% |
| Max Leverage | 5x |
| Liquidation Threshold | 85% |
| Liquidator Bonus | 5% |
| Oracle | Styks TWAP (CSPR/USD) |

## Quick Start

### Prerequisites

- [Rust nightly](https://rustup.rs/) (nightly-2025-01-05)
- [Odra CLI](https://odra.dev/)
- [pnpm](https://pnpm.io/)
- [Casper Wallet](https://www.casperwallet.io/) browser extension

### Contracts (Odra/Rust)

```bash
cd casper/magni_casper

# Run tests
cargo odra test

# Build WASM contracts
cargo odra build

# Deploy to testnet (requires .env with CASPER_SECRET_KEY)
cargo run --bin magni_livenet --release
```

### Frontend (React)

```bash
cd casper/frontend

# Install dependencies
pnpm install

# Copy and configure environment
cp .env.example .env
# Edit .env with deployed contract hashes

# Start dev server
pnpm dev
```

## Contracts

### tCSPR (Test CSPR)
CEP-18 token with public faucet for testnet usage.

### mCSPR (Magni CSPR)
Debt token minted when borrowing, burned when repaying. Minter-controlled.

### Magni
Core protocol contract:
- `open_position(collateral_amount, leverage)` - Deposit and borrow
- `close_position()` - Repay debt and withdraw collateral
- `liquidate(user)` - Liquidate unhealthy positions
- `get_price()` - Query oracle price (via Styks)

## Environment Variables

### Contracts (.env)
```
CASPER_SECRET_KEY=<your-testnet-secret-key>
CASPER_NODE_ADDRESS=https://rpc.testnet.casperlabs.io/rpc
CASPER_CHAIN_NAME=casper-test
STYKS_PRICE_FEED_PACKAGE_HASH=<styks-contract-hash>
STYKS_PRICE_FEED_ID=CSPR/USD
DEFAULT_VALIDATOR_PUBLIC_KEY=<validator-pubkey>
```

### Frontend (.env)
```
VITE_CASPER_CHAIN_NAME=casper-test
VITE_CASPER_NODE_URL=https://rpc.testnet.casperlabs.io/rpc
VITE_TCSPR_CONTRACT_HASH=<deployed-tcspr-hash>
VITE_MCSPR_CONTRACT_HASH=<deployed-mcspr-hash>
VITE_MAGNI_CONTRACT_HASH=<deployed-magni-hash>
```

## License

ISC
