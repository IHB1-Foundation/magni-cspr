# Vault Staking Architecture (T12)

**Date**: 2026-01-10
**Based on**: T11 Research (Track A - on-chain delegation)

## Track Selection

### Decision: **Track A (On-Chain Delegation)**

Based on T11 findings:
- Odra 2.4 provides `delegate/undelegate/delegated_amount` API
- Casper 2.0 enables liquid staking from contracts
- Compilation and local tests pass

Track A allows the contract to:
1. Receive native CSPR from users
2. Delegate to validators directly
3. Manage unbonding automatically

## Unit System Design

### The Problem

| System | Unit | Decimals | Range |
|--------|------|----------|-------|
| Casper staking | motes | 9 (1 CSPR = 1e9 motes) | U512 |
| Current PoC | tokens | 18 decimals | U256 |

### Decision: **Motes (U512) for Internal Accounting**

All position amounts will be stored in **motes** (native Casper unit):
- Eliminates decimal conversion errors
- Direct compatibility with staking API
- Frontend handles display conversion (motes → CSPR)

```rust
// Position stored in motes
pub struct Position {
    pub equity: U512,         // User's deposit in motes
    pub debt: U512,           // Borrowed amount in motes
    pub total_staked: U512,   // equity + debt, delegated to validator
    pub validator: String,    // Validator public key
    pub status: PositionStatus,
}
```

## Leverage Mathematics

### Corrected Model

The current implementation has a mathematical inconsistency. Here's the correct model:

```
Given:
- D = deposit (user equity)
- L = leverage multiplier (1 to 5)
- LTV_MAX = 80%

Then:
- total_staked = D * L
- debt = D * (L - 1)  // Amount borrowed from reserve
- LTV = debt / total_staked = (L-1)/L

Verification for L=5:
- total_staked = D * 5
- debt = D * 4
- LTV = 4/5 = 80% ✓
```

### Example

| Leverage | Deposit | Total Staked | Debt | LTV |
|----------|---------|--------------|------|-----|
| 1x | 100 CSPR | 100 CSPR | 0 | 0% |
| 2x | 100 CSPR | 200 CSPR | 100 CSPR | 50% |
| 3x | 100 CSPR | 300 CSPR | 200 CSPR | 67% |
| 5x | 100 CSPR | 500 CSPR | 400 CSPR | 80% |

### Current Implementation Bug

```rust
// WRONG (current):
debt = collateral_amount * (leverage - 1) * LTV / 100

// For L=5, D=100: debt = 100 * 4 * 0.8 = 320
// This is incorrect!

// CORRECT (new):
debt = equity * (leverage - 1)

// For L=5, D=100: debt = 100 * 4 = 400
// total_staked = equity + debt = 100 + 400 = 500
// LTV = 400/500 = 80% ✓
```

## Position State Machine

```
┌─────────────┐
│   EMPTY     │  (no position)
└──────┬──────┘
       │ open_position()
       ▼
┌─────────────┐
│   ACTIVE    │  equity staked + debt borrowed
│             │  CSPR delegated to validator
└──────┬──────┘
       │ request_close()
       ▼
┌─────────────┐
│  UNBONDING  │  undelegate submitted
│             │  waiting for 7 eras (~14h)
└──────┬──────┘
       │ finalize_close()
       │ (after unbonding complete)
       ▼
┌─────────────┐
│   EMPTY     │  debt repaid, equity returned
└─────────────┘
```

### Status Enum

```rust
#[odra::odra_type]
pub enum PositionStatus {
    Empty = 0,
    Active = 1,
    Unbonding = 2,  // Close requested, waiting for era boundary
}
```

## Entrypoints

### Core Operations

```rust
/// Open a leveraged staking position
/// User attaches CSPR (equity), contract borrows from reserve
/// Total amount is delegated to validator
#[odra(payable)]
pub fn open_position(&mut self, leverage: u8);

/// Request to close position (starts unbonding)
/// Submits undelegate to validator
/// Position moves to Unbonding status
pub fn request_close_position(&mut self);

/// Finalize close after unbonding completes
/// Burns mCSPR debt, returns equity + rewards to user
/// Repays borrowed amount to reserve
pub fn finalize_close_position(&mut self);
```

### Reserve Management (Owner Only)

```rust
/// Add CSPR to reserve pool for leverage lending
#[odra(payable)]
pub fn provide_reserve(&mut self);

/// Withdraw CSPR from reserve (must maintain min liquidity)
pub fn withdraw_reserve(&mut self, amount: U512);
```

### View Functions

```rust
/// Get complete position info
pub fn get_position(&self, user: Address) -> PositionInfo;

/// Get reserve available for lending
pub fn reserve_available(&self) -> U512;

/// Check if finalize_close is possible
pub fn can_finalize(&self, user: Address) -> bool;
```

## Reserve System

### Purpose

The reserve provides liquidity for leverage:
- When user opens 5x position with 100 CSPR equity
- Reserve provides 400 CSPR debt
- Total 500 CSPR is delegated

### Constraints

1. **Reserve must be liquid (un-staked)**
   - Staked reserve would require unbonding delay
   - Cannot provide instant leverage

2. **Minimum reserve ratio**
   - Reserve should cover potential leverage demands
   - Consider: `min_reserve >= max_position_size * (max_leverage - 1)`

3. **Owner-managed initially**
   - Simple model: owner provides/withdraws reserve
   - Future: LP pool with yield sharing

### Implementation

```rust
pub struct Magni {
    // ...existing fields...

    /// Reserve pool for lending (in motes)
    reserve_balance: Var<U512>,

    /// Total amount lent out (in motes)
    total_debt: Var<U512>,
}
```

## mCSPR Token Role

### Current: Debt Tracking Token

mCSPR represents debt that user must repay to close position.

### New Consideration

With native CSPR staking:
- mCSPR still represents debt (borrowed CSPR from reserve)
- User receives mCSPR equal to `debt` amount when opening
- User must return mCSPR to close (contract burns it)

This maintains the "leverage staking" concept where:
1. User deposits equity
2. Contract lends additional CSPR (represented by mCSPR debt token)
3. Total is staked to validator
4. User returns mCSPR (debt repayment) + receives rewards on close

## Migration from Current PoC

### Changes Required

1. **Remove tCSPR dependency** (or keep for demo mode)
   - Production: Native CSPR only
   - Demo: tCSPR simulation mode

2. **Add payable to open_position**
   - User attaches CSPR instead of transferring tCSPR

3. **Integrate staking API**
   - On open: `self.env().delegate(validator, total_staked)`
   - On request_close: `self.env().undelegate(validator, total_staked)`

4. **Add 2-step close**
   - `request_close_position()` → submits undelegate
   - `finalize_close_position()` → after unbonding, transfers CSPR

5. **Add reserve system**
   - Owner provides initial liquidity
   - Contract manages lending/repayment

6. **Fix leverage math**
   - Remove erroneous `* LTV` in debt calculation

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Reserve depletion | Minimum reserve requirement, max leverage cap |
| Unbonding delay | Clear UX messaging, 2-step close flow |
| Validator slashing | (Future) Multi-validator distribution |
| Contract upgrade | Upgradeable contract pattern (Casper 2.0) |

## Next Steps (T13)

1. Refactor `magni.rs` to Track A architecture
2. Add `#[odra(payable)]` and staking integration
3. Implement 2-step close with status tracking
4. Add reserve system
5. Update frontend for native CSPR deposits
6. End-to-end test on casper-test

## Appendix: Constants

```rust
// Staking
const MIN_DELEGATION_MOTES: u64 = 500_000_000_000; // 500 CSPR
const UNBONDING_ERAS: u32 = 7;                     // ~14 hours

// Leverage
const MAX_LEVERAGE: u8 = 5;
const LTV_MAX_PERCENT: u64 = 80;
const LIQUIDATION_THRESHOLD_PERCENT: u64 = 85;

// Reserve
const MIN_RESERVE_RATIO_PERCENT: u64 = 20;  // 20% of capacity
```
