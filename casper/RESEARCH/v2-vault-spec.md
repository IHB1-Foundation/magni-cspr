# V2 CSPR Vault Specification

**Date**: 2026-01-10
**Status**: T14 - Design Specification

## Overview

V2 redesigns the Magni contract from a "leverage position" model to a **collateral-debt vault** model:
- Users deposit CSPR as collateral (delegated to validators for staking yield)
- Users can borrow mCSPR (debt token) against collateral up to 80% LTV
- Debt accrues interest at 2% APR
- Users can add collateral, repay debt, or withdraw collateral (subject to LTV constraints)
- Withdrawals use a 2-step process due to staking unbonding delay

**Out of Scope**: The leverage loop (mCSPR → SwapPool → CSPR → re-deposit) is implemented externally.

---

## 1. Terminology

| Term | Definition |
|------|------------|
| **Collateral** | Native CSPR deposited by user (stored as motes, U512) |
| **Debt** | mCSPR borrowed against collateral (stored as wad, U256, 18 decimals) |
| **LTV** | Loan-to-Value = debt_value / collateral_value (assuming 1:1 price) |
| **LTV_MAX** | Maximum allowed LTV = 80% (8000 bps) |
| **Health Factor** | collateral_value * LTV_MAX / debt_value (>1 = healthy) |
| **Unbonding** | Period after undelegate before CSPR becomes liquid (~7 eras, ~14h) |
| **Pending Withdraw** | Withdrawal request waiting for unbonding to complete |
| **Motes** | Native CSPR unit (1 CSPR = 1e9 motes), stored as U512 |
| **Wad** | 18-decimal fixed-point unit for mCSPR, stored as U256 |

---

## 2. Unit Conversions

### 2.1 Constants

```rust
const MOTES_PER_CSPR: u64 = 1_000_000_000;        // 1e9
const WAD: u128 = 1_000_000_000_000_000_000;      // 1e18
const MOTES_TO_WAD_FACTOR: u128 = 1_000_000_000;  // 1e9 (18 - 9 = 9 zeros)
```

### 2.2 Conversion Functions

```rust
/// Convert motes (U512, 9 decimals) to wad (U256, 18 decimals)
/// 1 CSPR (1e9 motes) = 1e18 wad
/// Formula: wad = motes * 1e9
fn motes_to_wad(motes: U512) -> U256 {
    let motes_u128 = motes.as_u128();
    U256::from(motes_u128) * U256::from(MOTES_TO_WAD_FACTOR)
}

/// Convert wad (U256, 18 decimals) to motes (U512, 9 decimals)
/// Formula: motes = wad / 1e9 (round down - conservative for protocol)
fn wad_to_motes(wad: U256) -> U512 {
    let motes_u256 = wad / U256::from(MOTES_TO_WAD_FACTOR);
    U512::from(motes_u256.as_u128())
}
```

### 2.3 Rounding Rules

- **Borrowing**: Round DOWN mCSPR minted (user receives less) - protocol favorable
- **Repaying**: Round UP motes equivalent for debt calculation - protocol favorable
- **Withdrawing**: Round DOWN collateral returned - protocol favorable
- **Interest**: Round UP when calculating accrued interest - protocol favorable

---

## 3. Interest Model

### 3.1 Parameters

```rust
const INTEREST_RATE_BPS: u64 = 200;    // 2% APR = 200 basis points
const BPS_DIVISOR: u64 = 10_000;
const SECONDS_PER_YEAR: u64 = 31_536_000; // 365 * 24 * 60 * 60
```

### 3.2 Simple Interest (Per-User)

We use **simple interest with on-demand accrual**:

```
interest = principal * rate * time_elapsed / year
debt_with_interest = principal + interest
```

### 3.3 Storage

Per-user:
- `debt_principal: U256` - Original borrowed amount (wad)
- `last_accrual_ts: u64` - Timestamp of last interest accrual

### 3.4 Accrual Function

```rust
fn accrue_interest(&mut self, user: Address) {
    let principal = self.debt_principal.get(&user).unwrap_or_default();
    if principal == U256::zero() {
        return;
    }

    let last_ts = self.last_accrual_ts.get(&user).unwrap_or(self.env().get_block_time());
    let now = self.env().get_block_time();
    let elapsed = now.saturating_sub(last_ts);

    // interest = principal * rate * elapsed / (year * BPS_DIVISOR)
    // Using u128 intermediate to prevent overflow
    let interest = principal
        .checked_mul(U256::from(INTEREST_RATE_BPS))
        .and_then(|x| x.checked_mul(U256::from(elapsed)))
        .map(|x| x / U256::from(SECONDS_PER_YEAR * BPS_DIVISOR))
        .unwrap_or_default();

    // Round up: if there's any remainder, add 1
    let interest = if interest > U256::zero() {
        interest + U256::one()
    } else {
        interest
    };

    self.debt_principal.set(&user, principal + interest);
    self.last_accrual_ts.set(&user, now);
}
```

---

## 4. State Machine

### 4.1 Vault Status

```rust
#[odra::odra_type]
#[derive(Default)]
pub enum VaultStatus {
    #[default]
    None = 0,      // No vault exists
    Active = 1,    // Vault is active (can borrow/repay/deposit)
    Withdrawing = 2, // Pending withdrawal (waiting for unbonding)
}
```

### 4.2 State Transitions

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌──────────┐    deposit()    ┌──────────┐                    │
│   None   │ ───────────────►│  Active  │◄───────────────────┘
└──────────┘                 └──────────┘     (finalize if healthy)
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          │ add_collateral()      │ borrow()              │ repay()
          │ (self-loop)           │ (self-loop)           │ (self-loop)
          │                       │                       │
          ▼                       ▼                       ▼
     [collateral++]         [debt++, mint]         [debt--, burn]
                                  │
                                  │ request_withdraw()
                                  ▼
                           ┌─────────────┐
                           │ Withdrawing │
                           └─────────────┘
                                  │
                                  │ finalize_withdraw()
                                  │ (if unbonding complete)
                                  ▼
                    ┌──────────────────────────────┐
                    │ Active (if collateral > 0)   │
                    │ OR None (if collateral == 0) │
                    └──────────────────────────────┘
```

---

## 5. Entrypoint Signatures

### 5.1 User Functions

```rust
/// Deposit CSPR as collateral. Creates vault if none exists.
/// Attached CSPR is added to collateral and delegated to validator (batched).
#[odra(payable)]
pub fn deposit(&mut self);

/// Alias for deposit() - add more collateral to existing vault.
#[odra(payable)]
pub fn add_collateral(&mut self);

/// Borrow mCSPR against collateral.
/// @param amount_wad: Amount of mCSPR to borrow (18 decimals)
/// Reverts if resulting LTV > 80%
pub fn borrow(&mut self, amount_wad: U256);

/// Repay mCSPR debt.
/// @param amount_wad: Amount of mCSPR to repay (18 decimals)
/// Uses approve → transfer_from → burn pattern.
/// If amount_wad > debt, only repays debt (no excess burn).
pub fn repay(&mut self, amount_wad: U256);

/// Request withdrawal of collateral.
/// @param amount_motes: Amount of CSPR to withdraw (motes)
/// Reverts if resulting LTV > 80%
/// Triggers undelegate if insufficient liquid balance.
pub fn request_withdraw(&mut self, amount_motes: U512);

/// Finalize pending withdrawal after unbonding completes.
/// Transfers CSPR to user and clears pending state.
pub fn finalize_withdraw(&mut self);
```

### 5.2 Admin Functions

```rust
/// Set validator public key (owner only)
pub fn set_validator_public_key(&mut self, new_key: String);

/// Pause contract (owner only)
pub fn pause(&mut self);

/// Unpause contract (owner only)
pub fn unpause(&mut self);
```

### 5.3 View Functions

```rust
/// Get complete position info for user
pub fn get_position(&self, user: Address) -> PositionInfo;

/// Get collateral in motes
pub fn collateral_of(&self, user: Address) -> U512;

/// Get debt with accrued interest in wad
pub fn debt_of(&self, user: Address) -> U256;

/// Get current LTV in basis points (0-10000)
pub fn ltv_of(&self, user: Address) -> u64;

/// Get health factor (scaled by 1e4, >10000 = healthy)
pub fn health_factor_of(&self, user: Address) -> u64;

/// Get pending withdraw amount
pub fn pending_withdraw_of(&self, user: Address) -> U512;

/// Get vault status
pub fn status_of(&self, user: Address) -> u8;

/// Get contract's liquid CSPR balance
pub fn liquid_balance(&self) -> U512;

/// Get total delegated amount
pub fn total_delegated(&self) -> U512;
```

### 5.4 Return Types

```rust
pub struct PositionInfo {
    pub collateral_motes: U512,
    pub collateral_wad: U256,
    pub debt_wad: U256,
    pub ltv_bps: u64,
    pub health_factor: u64,
    pub pending_withdraw_motes: U512,
    pub status: u8,
}
```

---

## 6. Invariants

### 6.1 LTV Constraint (Post-Action)

After every state-modifying action:
```
debt_with_interest(user) <= collateral_value(user) * LTV_MAX / BPS_DIVISOR
```

Equivalently (with 1:1 price assumption):
```
debt_wad <= motes_to_wad(collateral_motes) * 8000 / 10000
```

### 6.2 No Negative Debt

```
debt_principal(user) >= 0  // U256 ensures this
repay() caps at current debt, no excess burn
```

### 6.3 mCSPR Supply Consistency

```
mCSPR.total_supply() == sum(debt_principal(all_users))
```

Note: With interest accrual, this may drift slightly. We accept this as interest is "virtual" until an action triggers accrual and mint.

### 6.4 Collateral Accounting

```
sum(collateral(all_users)) + pending_to_delegate <=
    liquid_balance + total_delegated
```

### 6.5 Withdrawal Safety

```
After request_withdraw:
  remaining_collateral >= debt_with_interest * BPS_DIVISOR / LTV_MAX
```

---

## 7. Staking/Delegation Policy

### 7.1 Minimum Delegation

Casper requires minimum 500 CSPR per delegation.

### 7.2 Batching Strategy

- Deposits accumulate in `pending_to_delegate` until >= 500 CSPR
- When threshold reached, `delegate()` is called
- Events: `DelegationBatched(amount)`

### 7.3 Withdrawal Flow

1. `request_withdraw(amount)`:
   - Check LTV remains safe after withdrawal
   - If `liquid_balance >= amount`: mark for immediate finalize
   - Else: call `undelegate(amount)`, set status to `Withdrawing`

2. `finalize_withdraw()`:
   - Check `liquid_balance >= pending_withdraw_amount`
   - Transfer CSPR to user
   - Clear pending state
   - Set status back to `Active` (or `None` if no collateral left)

---

## 8. Events

```rust
pub mod events {
    #[odra::event]
    pub struct Deposited {
        pub user: Address,
        pub amount_motes: U512,
        pub new_collateral_motes: U512,
    }

    #[odra::event]
    pub struct Borrowed {
        pub user: Address,
        pub amount_wad: U256,
        pub new_debt_wad: U256,
    }

    #[odra::event]
    pub struct Repaid {
        pub user: Address,
        pub amount_wad: U256,
        pub new_debt_wad: U256,
    }

    #[odra::event]
    pub struct WithdrawRequested {
        pub user: Address,
        pub amount_motes: U512,
    }

    #[odra::event]
    pub struct WithdrawFinalized {
        pub user: Address,
        pub amount_motes: U512,
    }

    #[odra::event]
    pub struct DelegationBatched {
        pub amount_motes: U512,
    }

    #[odra::event]
    pub struct UndelegationRequested {
        pub amount_motes: U512,
    }

    #[odra::event]
    pub struct InterestAccrued {
        pub user: Address,
        pub interest_wad: U256,
    }
}
```

---

## 9. Errors

```rust
#[odra::odra_error]
pub enum VaultError {
    NoVault = 1,
    VaultAlreadyExists = 2,
    InsufficientCollateral = 3,
    LtvExceeded = 4,
    InsufficientDebt = 5,
    InsufficientAllowance = 6,
    WithdrawPending = 7,
    NoWithdrawPending = 8,
    UnbondingNotComplete = 9,
    BelowMinDeposit = 10,
    ContractPaused = 11,
    Unauthorized = 12,
    InvalidValidatorKey = 13,
    ZeroAmount = 14,
    Overflow = 15,
}
```

---

## 10. Implementation Notes

### 10.1 Repay Pattern

To avoid "user sent mCSPR elsewhere and can't close" issues:

```rust
pub fn repay(&mut self, amount_wad: U256) {
    self.accrue_interest(caller);

    let debt = self.debt_principal.get(&caller).unwrap_or_default();
    let repay_amount = amount_wad.min(debt);  // Cap at debt

    // Transfer mCSPR from user to contract (requires prior approve)
    mcspr.transfer_from(caller, self_address, repay_amount);

    // Burn the received mCSPR
    mcspr.burn(self_address, repay_amount);

    // Update debt
    self.debt_principal.set(&caller, debt - repay_amount);
}
```

### 10.2 PoC Migration

The existing `open_position(leverage)` / `close_position()` / `request_close_position()` / `finalize_close_position()` entrypoints will be **removed** in V2. The new entrypoints provide more granular control.

### 10.3 Price Oracle

V2 assumes **1 mCSPR = 1 CSPR** for LTV calculations. Oracle-based USD pricing is out of scope.

---

## Appendix: Quick Reference

| Operation | Preconditions | Effects |
|-----------|---------------|---------|
| `deposit()` | attached > 0 | collateral += attached, trigger delegate batch |
| `add_collateral()` | attached > 0 | Same as deposit() |
| `borrow(amt)` | amt > 0, LTV_after <= 80% | debt += amt, mint mCSPR |
| `repay(amt)` | allowance >= amt | debt -= min(amt, debt), burn mCSPR |
| `request_withdraw(amt)` | LTV_after <= 80%, status != Withdrawing | pending = amt, undelegate if needed |
| `finalize_withdraw()` | status == Withdrawing, liquid >= pending | transfer CSPR, clear pending |
