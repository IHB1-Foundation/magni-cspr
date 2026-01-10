# Research: Delegation from Smart Contract (T11)

**Date**: 2026-01-10
**Casper Network Version**: 2.0 (launched May 2025)
**Odra Version**: 2.4
**Status**: API CONFIRMED, LIVENET VERIFICATION PENDING

## Summary

This research spike investigates whether a stored contract (WASM) can directly call Casper's native delegation/undelegation system via Odra's staking API.

### Key Findings

1. **Odra 2.4 Staking API Exists**: The `ContractEnv` trait exposes:
   - `delegate(validator: PublicKey, amount: U512)`
   - `undelegate(validator: PublicKey, amount: U512)`
   - `delegated_amount(validator: PublicKey) -> U512`

2. **Compilation Succeeds**: A PoC contract using these APIs compiles successfully for both native and WASM targets.

3. **Casper 2.0 Liquid Staking**: According to [Casper Network announcements](https://www.casper.network/unboxing-casper-2-0-casper-network) (September 2025), "Smart contracts can now interact directly with Casper's auction system, enabling on-chain applications to stake CSPR."

## Background

### Historical Limitation

Before Casper 2.0, contracts could not directly stake because:
- Delegation required a "main purse" which is account-specific
- System contract calls had restrictions on the entity model
- Reference: [Casper Staking from Smart Contract (Medium)](https://medium.com/casper-association-r-d/casper-staking-from-smart-contract-2143df7752fc)

### Casper 2.0 Changes

The May 2025 Casper 2.0 upgrade introduced:
- **CEP-86**: Native factory contract support
- **CEP-88**: On-chain event subscriptions
- **CEP-90**: Validator min/max delegation configuration
- **Liquid Staking Beta**: Contracts can now stake CSPR and receive yield

### Odra 2.4 API

From the Odra documentation at [docs.odra.dev/advanced-features/staking](https://docs.odra.dev/advanced-features/staking):

```rust
// Delegate CSPR to a validator
self.env().delegate(validator_public_key: PublicKey, amount: U512);

// Undelegate CSPR from a validator
self.env().undelegate(validator_public_key: PublicKey, amount: U512);

// Query delegated amount
self.env().delegated_amount(validator_public_key: PublicKey) -> U512;
```

## Implementation

### PoC Contract

File: `casper/magni_casper/src/staking_poc.rs`

```rust
#[odra(payable)]
pub fn stake(&mut self, validator_public_key: String) {
    let amount = self.env().attached_value();
    let validator_pk = self.parse_validator_key(&validator_public_key);

    // Call Odra's native staking API
    self.env().delegate(validator_pk, amount);
}
```

### Livenet Test Binary

File: `casper/magni_casper/src/bin/staking_poc_livenet.rs`

Run command:
```bash
# Set environment variables
export ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/path/to/secret_key.pem
export ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.casper.network/rpc
export ODRA_CASPER_LIVENET_EVENTS_URL=https://events.testnet.casper.network/events/main
export ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test
export STAKING_POC_VALIDATOR=012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80
export STAKING_POC_AMOUNT_CSPR=500  # Minimum delegation amount

# Run the test
cargo run --bin staking_poc_livenet --features=livenet
```

## Test Results

### odra-test (Local Simulation)
- **Status**: PASSED
- **Notes**: `cargo odra test` completes without errors. The staking API calls are accepted in the mock environment.

### WASM Build
- **Status**: PASSED
- **Notes**: `cargo odra build` succeeds. The contract compiles to WASM.

### Livenet (casper-test)
- **Status**: PENDING VERIFICATION
- **Notes**: The livenet binary is ready. Actual testnet verification requires:
  1. Funded account with 500+ CSPR (minimum delegation)
  2. Valid validator public key
  3. Deployment to casper-test network

## Verification Commands

### Check Delegation via RPC

```bash
# Query auction info to verify delegation
curl -X POST https://node.testnet.casper.network/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"state_get_auction_info"}'
```

### Expected Success Indicators

If delegation works:
1. `stake()` call completes without revert
2. `delegated_amount()` returns non-zero value
3. `state_get_auction_info` shows contract as delegator

### Possible Failure Modes

1. **Revert on delegate()**: System contract call restriction
2. **No-op**: API accepted but delegation not actually performed
3. **Main purse error**: Contract purse not eligible for delegation

## Conclusion

### Preliminary Assessment: TRACK A LIKELY VIABLE

Based on:
1. Casper 2.0 explicitly enables liquid staking from contracts
2. Odra 2.4 provides the staking API
3. Compilation and local tests pass

**Recommendation**: Proceed with Track A (on-chain delegation) implementation, with fallback to Track B1/B2 if livenet verification fails.

### Track Definitions

| Track | Description | Contract Complexity | Trust Model |
|-------|-------------|---------------------|-------------|
| **A** | Contract delegates directly | High | Trustless |
| **B1** | User delegates via frontend | Low | User custody |
| **B2** | Operator delegates off-chain | Medium | Trusted operator |

### Next Steps

1. **T11 Completion**: Run `staking_poc_livenet` on casper-test with funded account
2. **T12**: Based on livenet result, finalize vault architecture
3. **T13**: Implement end-to-end flow for selected track

## References

- [Casper Delegation Docs](https://docs.casper.network/users/delegating/)
- [Casper 2.0 Announcement](https://www.casper.network/unboxing-casper-2-0-casper-network)
- [Odra Staking API](https://docs.odra.dev/advanced-features/staking)
- [Halborn Liquid Staking Audit](https://www.halborn.com/audits/casper-association/odra---liquid-staking-231379)
- [Historical Context: Staking from Contract Limitations](https://medium.com/casper-association-r-d/casper-staking-from-smart-contract-2143df7752fc)

## Appendix: Key Technical Details

### Minimum Delegation
- **Amount**: 500 CSPR (500,000,000,000 motes)
- **Source**: [Casper Docs](https://docs.casper.network/users/delegating/)

### Unbonding Period
- **Duration**: 7 eras (~14 hours)
- **Impact**: Close position requires 2-step process (request → finalize after unbonding)

### Validator Key Format
- Ed25519: `01` prefix + 32 bytes (66 hex chars total)
- Secp256k1: `02` prefix + 33 bytes (68 hex chars total)

### Example Testnet Validator
```
012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80
```
