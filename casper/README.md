# Magni x Casper

Magni V2 is a **CSPR vault** on Casper Network (Odra/Rust):
- Users deposit native CSPR as collateral.
- The protocol delegates pooled collateral to a validator (staking).
- Users can borrow **mCSPR** (debt token) up to **80% LTV**.
- Debt accrues **2% APR** interest.
- Users can add collateral / repay any time.
- Withdrawals are **2-step** due to Casper unbonding: `request_withdraw` → `finalize_withdraw`.

Leverage (looping `mCSPR -> swap -> CSPR -> deposit`) is intentionally **out of scope** and should be done externally.

## Contracts

| Contract | Description |
|----------|-------------|
| mCSPR | CEP-18 debt token (Magni-only mint/burn) |
| Magni | V2 CSPR vault + delegation batching + withdraw (2-step) |
| (Legacy) tCSPR | Old demo token (kept for backwards compatibility) |

## Demo Flow

1. Deposit CSPR (payable): `deposit()`
2. Borrow mCSPR: `borrow(amount_wad)` (max 80% LTV)
3. Repay: `mCSPR.approve(Magni, amount)` → `repay(amount_wad)`
4. Request withdraw: `request_withdraw(amount_motes)` (may undelegate)
5. Finalize withdraw after unbonding: `finalize_withdraw()`

## Requirements

- Rust nightly toolchain (nightly-2025-01-05)
- wasm32-unknown-unknown target
- cargo-odra
- binaryen (wasm-opt)
- wabt (wasm-strip)

## Quick Start

```bash
# 1. Setup (installs toolchain and dependencies)
bash casper/scripts/setup.sh

# 2. Build WASM contracts
bash casper/scripts/build.sh

# 3. Run tests
bash casper/scripts/test.sh

# 4. Configure environment
cp casper/.env.example casper/.env
# Edit casper/.env with your values

# 5. Deploy to testnet and run demo (deposit -> borrow -> request_withdraw)
bash casper/scripts/livenet_deploy_and_demo.sh
```

## Environment Variables

Copy `casper/.env.example` to `casper/.env` and configure:

```bash
# Casper Testnet (Odra Livenet)
ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/path/to/secret_key.pem
# NOTE: Odra appends "/rpc" internally, so set the base URL (no trailing /rpc).
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

# Default validator public key (01/02 prefix + hex)
DEFAULT_VALIDATOR_PUBLIC_KEY=012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80
```

## Project Structure

```
casper/
├── .env.example         # Environment template
├── README.md            # This file
├── PROJECT.md           # Project specification
├── TICKETS.md           # Implementation tickets
├── scripts/
│   ├── setup.sh         # Install dependencies
│   ├── build.sh         # Build WASM
│   ├── test.sh          # Run tests
│   └── livenet_deploy_and_demo.sh  # Deploy + demo
└── magni_casper/
    ├── Cargo.toml       # Rust dependencies
    ├── Odra.toml        # Odra contract config
    ├── rust-toolchain.toml
	    └── src/
	        ├── lib.rs       # Library root
	        ├── tokens.rs    # mCSPR (and legacy tCSPR)
	        ├── magni.rs     # V2 vault contract
	        ├── styks_external.rs  # Legacy/optional oracle interface
	        └── bin/
	            ├── magni_casper_build_contract.rs  # WASM builder
	            └── magni_livenet.rs  # Livenet deploy + demo
```

## Oracle Integration

V2 vault accounting assumes **1 mCSPR == 1 CSPR (nominal)** and does not require an oracle.
`styks_external.rs` remains in the repo for earlier PoC experiments / future extensions.

## Notes

- This is a hackathon prototype - not production ready
- T4 (Liquidation) is optional and not implemented
- All code is under `/casper` - no changes to parent monorepo
