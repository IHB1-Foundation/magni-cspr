//! Magni V2 CSPR Vault Contract
//!
//! A collateral-debt vault for CSPR on Casper Network.
//! - Users deposit CSPR as collateral (delegated to validators for staking)
//! - Users can borrow mCSPR (debt token) against collateral up to 80% LTV
//! - Debt accrues interest at 2% APR (simple interest)
//! - Withdrawals use 2-step process due to staking unbonding delay
//!
//! ## Units
//! - CSPR: motes (U512), 1 CSPR = 1e9 motes
//! - mCSPR: wad (U256), 18 decimals, 1 mCSPR = 1e18 wad
//!
//! ## Out of Scope
//! The leverage loop (mCSPR -> SwapPool -> CSPR -> re-deposit) is external.

use odra::prelude::*;
use odra::casper_types::{AsymmetricType, PublicKey, U256, U512};
use odra::ContractRef;
use crate::tokens::MCSPRTokenContractRef;
use alloc::vec::Vec;

// ==========================================
// Constants
// ==========================================

/// 1 CSPR = 1e9 motes
const MOTES_PER_CSPR: u64 = 1_000_000_000;
/// Conversion factor from motes (9 dec) to wad (18 dec) = 1e9
const MOTES_TO_WAD_FACTOR: u128 = 1_000_000_000;
/// 1 wad = 1e18
const WAD: u128 = 1_000_000_000_000_000_000;

/// LTV maximum = 80% = 8000 bps
const LTV_MAX_BPS: u64 = 8000;
/// Basis points divisor
const BPS_DIVISOR: u64 = 10_000;

/// Interest rate = 2% APR = 200 bps
const INTEREST_RATE_BPS: u64 = 200;
/// Seconds per year (365 days)
const SECONDS_PER_YEAR: u64 = 31_536_000;

/// Minimum delegation = 500 CSPR
const MIN_DELEGATION_MOTES: u64 = 500_000_000_000;

// ==========================================
// Events
// ==========================================

pub mod events {
    use odra::prelude::*;
    use odra::casper_types::{U256, U512};

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
        pub new_debt_wad: U256,
    }

    #[odra::event]
    pub struct Paused {
        pub by: Address,
    }

    #[odra::event]
    pub struct Unpaused {
        pub by: Address,
    }
}

// ==========================================
// Types
// ==========================================

/// Vault status for a user
#[odra::odra_type]
#[derive(Default)]
pub enum VaultStatus {
    #[default]
    None = 0,
    Active = 1,
    Withdrawing = 2,
}

/// Position info returned by get_position
#[odra::odra_type]
pub struct PositionInfo {
    pub collateral_motes: U512,
    pub collateral_wad: U256,
    pub debt_wad: U256,
    pub ltv_bps: u64,
    pub health_factor: u64,
    pub pending_withdraw_motes: U512,
    pub status: u8,
}

// ==========================================
// Errors
// ==========================================

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
    InsufficientLiquidBalance = 16,
}

// ==========================================
// Contract
// ==========================================

#[odra::module(events = [
    events::Deposited,
    events::Borrowed,
    events::Repaid,
    events::WithdrawRequested,
    events::WithdrawFinalized,
    events::DelegationBatched,
    events::UndelegationRequested,
    events::InterestAccrued,
    events::Paused,
    events::Unpaused
])]
pub struct Magni {
    // Token references
    mcspr: Var<Address>,

    // Staking config
    validator_public_key: Var<String>,

    // Per-user vault state
    collateral: Mapping<Address, U512>,      // User's collateral in motes
    debt_principal: Mapping<Address, U256>,   // User's debt in wad (18 dec)
    last_accrual_ts: Mapping<Address, u64>,   // Last interest accrual timestamp
    vault_status: Mapping<Address, VaultStatus>,
    pending_withdraw: Mapping<Address, U512>, // Pending withdrawal amount

    // Global state
    total_collateral: Var<U512>,             // Sum of all collateral
    total_debt: Var<U256>,                    // Sum of all debt
    pending_to_delegate: Var<U512>,          // CSPR waiting to be delegated (batching)
    total_delegated: Var<U512>,              // Total delegated to validator

    // Admin
    owner: Var<Address>,
    paused: Var<bool>,
}

#[odra::module]
impl Magni {
    // ==========================================
    // Initialization
    // ==========================================

    /// Initialize the Magni V2 vault contract
    pub fn init(&mut self, mcspr: Address, validator_public_key: String) {
        self.mcspr.set(mcspr);
        self.validator_public_key.set(validator_public_key);
        self.total_collateral.set(U512::zero());
        self.total_debt.set(U256::zero());
        self.pending_to_delegate.set(U512::zero());
        self.total_delegated.set(U512::zero());
        self.owner.set(self.env().caller());
        self.paused.set(false);
    }

    // ==========================================
    // User Functions
    // ==========================================

    /// Deposit CSPR as collateral.
    /// Creates vault if none exists, otherwise adds to existing collateral.
    #[odra(payable)]
    pub fn deposit(&mut self) {
        self.require_not_paused();
        let caller = self.env().caller();
        let amount = self.env().attached_value();

        if amount == U512::zero() {
            self.env().revert(VaultError::ZeroAmount);
        }

        // Update user's collateral
        let current = self.collateral.get(&caller).unwrap_or_default();
        let new_collateral = current + amount;
        self.collateral.set(&caller, new_collateral);

        // Update global collateral
        let total = self.total_collateral.get_or_default();
        self.total_collateral.set(total + amount);

        // Set vault status to Active if not already
        let status = self.vault_status.get(&caller).unwrap_or_default();
        if status == VaultStatus::None {
            self.vault_status.set(&caller, VaultStatus::Active);
            self.last_accrual_ts.set(&caller, self.env().get_block_time());
        }

        // Batch delegation
        self.batch_delegate(amount);

        self.env().emit_event(events::Deposited {
            user: caller,
            amount_motes: amount,
            new_collateral_motes: new_collateral,
        });
    }

    /// Alias for deposit - add more collateral to existing vault
    #[odra(payable)]
    pub fn add_collateral(&mut self) {
        self.deposit();
    }

    /// Borrow mCSPR against collateral.
    /// Reverts if resulting LTV > 80%
    pub fn borrow(&mut self, amount_wad: U256) {
        self.require_not_paused();
        let caller = self.env().caller();

        if amount_wad == U256::zero() {
            self.env().revert(VaultError::ZeroAmount);
        }

        // Check vault exists and is active
        let status = self.vault_status.get(&caller).unwrap_or_default();
        if status == VaultStatus::None {
            self.env().revert(VaultError::NoVault);
        }
        if status == VaultStatus::Withdrawing {
            self.env().revert(VaultError::WithdrawPending);
        }

        // Accrue interest first
        self.accrue_interest(caller);

        // Calculate new debt
        let current_debt = self.debt_principal.get(&caller).unwrap_or_default();
        let new_debt = current_debt + amount_wad;

        // Check LTV constraint
        let collateral_motes = self.collateral.get(&caller).unwrap_or_default();
        let collateral_wad = self.motes_to_wad(collateral_motes);
        let max_debt = collateral_wad * U256::from(LTV_MAX_BPS) / U256::from(BPS_DIVISOR);

        if new_debt > max_debt {
            self.env().revert(VaultError::LtvExceeded);
        }

        // Update debt
        self.debt_principal.set(&caller, new_debt);
        let total = self.total_debt.get_or_default();
        self.total_debt.set(total + amount_wad);

        // Mint mCSPR to user
        let mcspr_addr = self.mcspr.get().expect("mCSPR not set");
        let mut mcspr = MCSPRTokenContractRef::new(self.env().clone(), mcspr_addr);
        mcspr.mint(caller, amount_wad);

        self.env().emit_event(events::Borrowed {
            user: caller,
            amount_wad,
            new_debt_wad: new_debt,
        });
    }

    /// Repay mCSPR debt.
    /// Uses approve -> transfer_from -> burn pattern.
    /// If amount > debt, only repays debt.
    pub fn repay(&mut self, amount_wad: U256) {
        self.require_not_paused();
        let caller = self.env().caller();

        if amount_wad == U256::zero() {
            self.env().revert(VaultError::ZeroAmount);
        }

        // Check vault exists
        let status = self.vault_status.get(&caller).unwrap_or_default();
        if status == VaultStatus::None {
            self.env().revert(VaultError::NoVault);
        }

        // Accrue interest first
        self.accrue_interest(caller);

        // Get current debt and cap repay amount
        let current_debt = self.debt_principal.get(&caller).unwrap_or_default();
        if current_debt == U256::zero() {
            self.env().revert(VaultError::InsufficientDebt);
        }

        let repay_amount = if amount_wad > current_debt {
            current_debt
        } else {
            amount_wad
        };

        // Transfer mCSPR from user to this contract (requires prior approve)
        let mcspr_addr = self.mcspr.get().expect("mCSPR not set");
        let mut mcspr = MCSPRTokenContractRef::new(self.env().clone(), mcspr_addr);
        let self_address = self.env().self_address();

        // Check allowance first
        let allowance = mcspr.allowance(caller, self_address);
        if allowance < repay_amount {
            self.env().revert(VaultError::InsufficientAllowance);
        }

        // Transfer from user to contract
        mcspr.transfer_from(caller, self_address, repay_amount);

        // Burn the received mCSPR
        mcspr.burn(self_address, repay_amount);

        // Update debt
        let new_debt = current_debt - repay_amount;
        self.debt_principal.set(&caller, new_debt);
        let total = self.total_debt.get_or_default();
        if total >= repay_amount {
            self.total_debt.set(total - repay_amount);
        }

        self.env().emit_event(events::Repaid {
            user: caller,
            amount_wad: repay_amount,
            new_debt_wad: new_debt,
        });
    }

    /// Request withdrawal of collateral.
    /// Reverts if resulting LTV > 80%.
    /// Triggers undelegate if insufficient liquid balance.
    pub fn request_withdraw(&mut self, amount_motes: U512) {
        self.require_not_paused();
        let caller = self.env().caller();

        if amount_motes == U512::zero() {
            self.env().revert(VaultError::ZeroAmount);
        }

        // Check vault exists and is active
        let status = self.vault_status.get(&caller).unwrap_or_default();
        if status == VaultStatus::None {
            self.env().revert(VaultError::NoVault);
        }
        if status == VaultStatus::Withdrawing {
            self.env().revert(VaultError::WithdrawPending);
        }

        // Accrue interest first
        self.accrue_interest(caller);

        // Check collateral sufficient
        let current_collateral = self.collateral.get(&caller).unwrap_or_default();
        if amount_motes > current_collateral {
            self.env().revert(VaultError::InsufficientCollateral);
        }

        // Check LTV constraint after withdrawal
        let remaining_collateral = current_collateral - amount_motes;
        let debt = self.debt_principal.get(&caller).unwrap_or_default();

        if debt > U256::zero() {
            let remaining_wad = self.motes_to_wad(remaining_collateral);
            let max_debt = remaining_wad * U256::from(LTV_MAX_BPS) / U256::from(BPS_DIVISOR);
            if debt > max_debt {
                self.env().revert(VaultError::LtvExceeded);
            }
        }

        // Update collateral (reduce immediately)
        self.collateral.set(&caller, remaining_collateral);
        let total = self.total_collateral.get_or_default();
        if total >= amount_motes {
            self.total_collateral.set(total - amount_motes);
        }

        // Store pending withdrawal
        self.pending_withdraw.set(&caller, amount_motes);
        self.vault_status.set(&caller, VaultStatus::Withdrawing);

        // Check if we need to undelegate
        let liquid = self.env().self_balance();
        if liquid < amount_motes {
            // Need to undelegate
            let delegated = self.total_delegated.get_or_default();
            let undelegate_amount = amount_motes.min(delegated);

            if undelegate_amount > U512::zero() {
                let validator_key = self.validator_public_key.get_or_default();
                if !validator_key.is_empty() {
                    let validator_pk = self.parse_validator_key(&validator_key);
                    self.env().undelegate(validator_pk, undelegate_amount);
                    self.total_delegated.set(delegated - undelegate_amount);

                    self.env().emit_event(events::UndelegationRequested {
                        amount_motes: undelegate_amount,
                    });
                }
            }
        }

        self.env().emit_event(events::WithdrawRequested {
            user: caller,
            amount_motes,
        });
    }

    /// Finalize pending withdrawal after unbonding completes.
    pub fn finalize_withdraw(&mut self) {
        self.require_not_paused();
        let caller = self.env().caller();

        // Check vault is in withdrawing state
        let status = self.vault_status.get(&caller).unwrap_or_default();
        if status != VaultStatus::Withdrawing {
            self.env().revert(VaultError::NoWithdrawPending);
        }

        // Get pending amount
        let pending = self.pending_withdraw.get(&caller).unwrap_or_default();
        if pending == U512::zero() {
            self.env().revert(VaultError::NoWithdrawPending);
        }

        // Check liquid balance
        let liquid = self.env().self_balance();
        if liquid < pending {
            self.env().revert(VaultError::UnbondingNotComplete);
        }

        // Transfer CSPR to user
        self.env().transfer_tokens(&caller, &pending);

        // Clear pending state
        self.pending_withdraw.set(&caller, U512::zero());

        // Update vault status
        let remaining_collateral = self.collateral.get(&caller).unwrap_or_default();
        let remaining_debt = self.debt_principal.get(&caller).unwrap_or_default();

        if remaining_collateral == U512::zero() && remaining_debt == U256::zero() {
            self.vault_status.set(&caller, VaultStatus::None);
        } else {
            self.vault_status.set(&caller, VaultStatus::Active);
        }

        self.env().emit_event(events::WithdrawFinalized {
            user: caller,
            amount_motes: pending,
        });
    }

    /// Repay all debt including accrued interest.
    /// Calculates exact debt at execution time to handle real-time interest.
    pub fn repay_all(&mut self) {
        self.require_not_paused();
        let caller = self.env().caller();

        // Check vault exists
        let status = self.vault_status.get(&caller).unwrap_or_default();
        if status == VaultStatus::None {
            self.env().revert(VaultError::NoVault);
        }

        // Accrue interest first to get exact debt
        self.accrue_interest(caller);

        // Get current debt (now includes all accrued interest)
        let current_debt = self.debt_principal.get(&caller).unwrap_or_default();
        if current_debt == U256::zero() {
            self.env().revert(VaultError::InsufficientDebt);
        }

        // Transfer mCSPR from user to this contract (requires prior approve)
        let mcspr_addr = self.mcspr.get().expect("mCSPR not set");
        let mut mcspr = MCSPRTokenContractRef::new(self.env().clone(), mcspr_addr);
        let self_address = self.env().self_address();

        // Check allowance - must be >= current debt
        let allowance = mcspr.allowance(caller, self_address);
        if allowance < current_debt {
            self.env().revert(VaultError::InsufficientAllowance);
        }

        // Transfer from user to contract
        mcspr.transfer_from(caller, self_address, current_debt);

        // Burn the received mCSPR
        mcspr.burn(self_address, current_debt);

        // Update debt to zero
        self.debt_principal.set(&caller, U256::zero());
        let total = self.total_debt.get_or_default();
        if total >= current_debt {
            self.total_debt.set(total - current_debt);
        }

        self.env().emit_event(events::Repaid {
            user: caller,
            amount_wad: current_debt,
            new_debt_wad: U256::zero(),
        });
    }

    /// Withdraw maximum collateral while keeping LTV valid (≤80%).
    /// Calculates exact max amount at execution time to handle real-time interest.
    pub fn withdraw_max(&mut self) {
        self.require_not_paused();
        let caller = self.env().caller();

        // Check vault exists and is active
        let status = self.vault_status.get(&caller).unwrap_or_default();
        if status == VaultStatus::None {
            self.env().revert(VaultError::NoVault);
        }
        if status == VaultStatus::Withdrawing {
            self.env().revert(VaultError::WithdrawPending);
        }

        // Accrue interest first
        self.accrue_interest(caller);

        let current_collateral = self.collateral.get(&caller).unwrap_or_default();
        if current_collateral == U512::zero() {
            self.env().revert(VaultError::InsufficientCollateral);
        }

        let debt = self.debt_principal.get(&caller).unwrap_or_default();

        // Calculate max withdrawable amount
        // If no debt, can withdraw everything
        // If debt > 0, must keep: collateral_wad >= debt * BPS_DIVISOR / LTV_MAX_BPS
        let max_withdraw_motes = if debt == U256::zero() {
            current_collateral
        } else {
            // min_collateral_wad = debt * 10000 / 8000 = debt * 1.25
            let min_collateral_wad = debt * U256::from(BPS_DIVISOR) / U256::from(LTV_MAX_BPS);
            let current_collateral_wad = self.motes_to_wad(current_collateral);

            if current_collateral_wad <= min_collateral_wad {
                // Cannot withdraw anything
                self.env().revert(VaultError::LtvExceeded);
            }

            let max_withdraw_wad = current_collateral_wad - min_collateral_wad;
            self.wad_to_motes(max_withdraw_wad)
        };

        if max_withdraw_motes == U512::zero() {
            self.env().revert(VaultError::InsufficientCollateral);
        }

        // Update collateral
        let remaining_collateral = current_collateral - max_withdraw_motes;
        self.collateral.set(&caller, remaining_collateral);
        let total = self.total_collateral.get_or_default();
        if total >= max_withdraw_motes {
            self.total_collateral.set(total - max_withdraw_motes);
        }

        // Store pending withdrawal
        self.pending_withdraw.set(&caller, max_withdraw_motes);
        self.vault_status.set(&caller, VaultStatus::Withdrawing);

        // Check if we need to undelegate
        let liquid = self.env().self_balance();
        if liquid < max_withdraw_motes {
            let delegated = self.total_delegated.get_or_default();
            let undelegate_amount = max_withdraw_motes.min(delegated);

            if undelegate_amount > U512::zero() {
                let validator_key = self.validator_public_key.get_or_default();
                if !validator_key.is_empty() {
                    let validator_pk = self.parse_validator_key(&validator_key);
                    self.env().undelegate(validator_pk, undelegate_amount);
                    self.total_delegated.set(delegated - undelegate_amount);

                    self.env().emit_event(events::UndelegationRequested {
                        amount_motes: undelegate_amount,
                    });
                }
            }
        }

        self.env().emit_event(events::WithdrawRequested {
            user: caller,
            amount_motes: max_withdraw_motes,
        });
    }

    // ==========================================
    // View Functions
    // ==========================================

    /// Get complete position info for user
    pub fn get_position(&self, user: Address) -> PositionInfo {
        let collateral_motes = self.collateral.get(&user).unwrap_or_default();
        let collateral_wad = self.motes_to_wad(collateral_motes);
        let debt_wad = self.debt_with_interest(user);
        let pending_withdraw_motes = self.pending_withdraw.get(&user).unwrap_or_default();

        let status = match self.vault_status.get(&user).unwrap_or_default() {
            VaultStatus::None => 0,
            VaultStatus::Active => 1,
            VaultStatus::Withdrawing => 2,
        };

        // Calculate LTV (basis points)
        let ltv_bps = if collateral_wad == U256::zero() {
            0u64
        } else {
            let ltv = debt_wad * U256::from(BPS_DIVISOR) / collateral_wad;
            ltv.as_u64()
        };

        // Calculate health factor (scaled by 10000, >10000 = healthy)
        let health_factor = if debt_wad == U256::zero() {
            u64::MAX // Infinite health if no debt
        } else {
            let max_borrow = collateral_wad * U256::from(LTV_MAX_BPS) / U256::from(BPS_DIVISOR);
            let hf = max_borrow * U256::from(BPS_DIVISOR) / debt_wad;
            hf.as_u64()
        };

        PositionInfo {
            collateral_motes,
            collateral_wad,
            debt_wad,
            ltv_bps,
            health_factor,
            pending_withdraw_motes,
            status,
        }
    }

    /// Get collateral in motes
    pub fn collateral_of(&self, user: Address) -> U512 {
        self.collateral.get(&user).unwrap_or_default()
    }

    /// Get debt with accrued interest in wad (read-only calculation)
    pub fn debt_of(&self, user: Address) -> U256 {
        self.debt_with_interest(user)
    }

    /// Get current LTV in basis points
    pub fn ltv_of(&self, user: Address) -> u64 {
        let collateral_motes = self.collateral.get(&user).unwrap_or_default();
        if collateral_motes == U512::zero() {
            return 0;
        }
        let collateral_wad = self.motes_to_wad(collateral_motes);
        let debt_wad = self.debt_with_interest(user);
        let ltv = debt_wad * U256::from(BPS_DIVISOR) / collateral_wad;
        ltv.as_u64()
    }

    /// Get health factor (scaled by 10000)
    pub fn health_factor_of(&self, user: Address) -> u64 {
        let debt_wad = self.debt_with_interest(user);
        if debt_wad == U256::zero() {
            return u64::MAX;
        }
        let collateral_motes = self.collateral.get(&user).unwrap_or_default();
        let collateral_wad = self.motes_to_wad(collateral_motes);
        let max_borrow = collateral_wad * U256::from(LTV_MAX_BPS) / U256::from(BPS_DIVISOR);
        let hf = max_borrow * U256::from(BPS_DIVISOR) / debt_wad;
        hf.as_u64()
    }

    /// Get pending withdraw amount
    pub fn pending_withdraw_of(&self, user: Address) -> U512 {
        self.pending_withdraw.get(&user).unwrap_or_default()
    }

    /// Get maximum withdrawable amount while keeping LTV valid
    /// Returns 0 if cannot withdraw anything
    pub fn max_withdraw_of(&self, user: Address) -> U512 {
        let current_collateral = self.collateral.get(&user).unwrap_or_default();
        if current_collateral == U512::zero() {
            return U512::zero();
        }

        let debt = self.debt_with_interest(user);
        if debt == U256::zero() {
            // No debt, can withdraw everything
            return current_collateral;
        }

        // min_collateral_wad = debt * 10000 / 8000
        let min_collateral_wad = debt * U256::from(BPS_DIVISOR) / U256::from(LTV_MAX_BPS);
        let current_collateral_wad = self.motes_to_wad(current_collateral);

        if current_collateral_wad <= min_collateral_wad {
            return U512::zero();
        }

        let max_withdraw_wad = current_collateral_wad - min_collateral_wad;
        self.wad_to_motes(max_withdraw_wad)
    }

    /// Get vault status
    pub fn status_of(&self, user: Address) -> u8 {
        match self.vault_status.get(&user).unwrap_or_default() {
            VaultStatus::None => 0,
            VaultStatus::Active => 1,
            VaultStatus::Withdrawing => 2,
        }
    }

    /// Get contract's liquid CSPR balance
    pub fn liquid_balance(&self) -> U512 {
        self.env().self_balance()
    }

    /// Get total delegated amount (tracked)
    pub fn total_delegated(&self) -> U512 {
        self.total_delegated.get_or_default()
    }

    /// Get actual delegated amount from chain
    pub fn delegated_amount(&self) -> U512 {
        let validator_key = self.validator_public_key.get_or_default();
        if validator_key.is_empty() {
            return U512::zero();
        }
        let validator_pk = self.parse_validator_key(&validator_key);
        self.env().delegated_amount(validator_pk)
    }

    /// Get pending to delegate (batching pool)
    pub fn pending_to_delegate(&self) -> U512 {
        self.pending_to_delegate.get_or_default()
    }

    /// Get total collateral across all users
    pub fn total_collateral(&self) -> U512 {
        self.total_collateral.get_or_default()
    }

    /// Get total debt across all users
    pub fn total_debt(&self) -> U256 {
        self.total_debt.get_or_default()
    }

    /// Get mCSPR token address
    pub fn mcspr(&self) -> Option<Address> {
        self.mcspr.get()
    }

    /// Get validator public key
    pub fn validator_public_key(&self) -> String {
        self.validator_public_key.get_or_default()
    }

    /// Get contract owner
    pub fn owner(&self) -> Option<Address> {
        self.owner.get()
    }

    /// Check if paused
    pub fn is_paused(&self) -> bool {
        self.paused.get_or_default()
    }

    // ==========================================
    // Admin Functions
    // ==========================================

    /// Set validator public key (owner only)
    pub fn set_validator_public_key(&mut self, new_key: String) {
        self.require_owner();
        self.validator_public_key.set(new_key);
    }

    /// Pause contract (owner only)
    pub fn pause(&mut self) {
        self.require_owner();
        if self.paused.get_or_default() {
            self.env().revert(VaultError::ContractPaused);
        }
        self.paused.set(true);
        self.env().emit_event(events::Paused {
            by: self.env().caller(),
        });
    }

    /// Unpause contract (owner only)
    pub fn unpause(&mut self) {
        self.require_owner();
        if !self.paused.get_or_default() {
            self.env().revert(VaultError::ContractPaused);
        }
        self.paused.set(false);
        self.env().emit_event(events::Unpaused {
            by: self.env().caller(),
        });
    }

    /// Manually trigger delegation batch (owner only, for testing)
    pub fn force_delegate(&mut self) {
        self.require_owner();
        let pending = self.pending_to_delegate.get_or_default();
        if pending > U512::zero() {
            self.execute_delegate(pending);
        }
    }

    // ==========================================
    // Internal Functions
    // ==========================================

    fn require_not_paused(&self) {
        if self.paused.get_or_default() {
            self.env().revert(VaultError::ContractPaused);
        }
    }

    fn require_owner(&self) {
        if self.owner.get() != Some(self.env().caller()) {
            self.env().revert(VaultError::Unauthorized);
        }
    }

    /// Accrue interest for user (updates state)
    fn accrue_interest(&mut self, user: Address) {
        let principal = self.debt_principal.get(&user).unwrap_or_default();
        if principal == U256::zero() {
            self.last_accrual_ts.set(&user, self.env().get_block_time());
            return;
        }

        let last_ts = self.last_accrual_ts.get(&user).unwrap_or(self.env().get_block_time());
        let now = self.env().get_block_time();

        if now <= last_ts {
            return;
        }

        let elapsed = now - last_ts;

        // interest = principal * rate * elapsed / (year * BPS_DIVISOR)
        // Using checked math to prevent overflow
        let interest = principal
            .checked_mul(U256::from(INTEREST_RATE_BPS))
            .and_then(|x| x.checked_mul(U256::from(elapsed)))
            .map(|x| x / U256::from(SECONDS_PER_YEAR as u128 * BPS_DIVISOR as u128))
            .unwrap_or_default();

        if interest > U256::zero() {
            let new_principal = principal + interest;
            self.debt_principal.set(&user, new_principal);

            // Update global debt
            let total = self.total_debt.get_or_default();
            self.total_debt.set(total + interest);

            self.env().emit_event(events::InterestAccrued {
                user,
                interest_wad: interest,
                new_debt_wad: new_principal,
            });
        }

        self.last_accrual_ts.set(&user, now);
    }

    /// Calculate debt with interest (read-only, doesn't update state)
    fn debt_with_interest(&self, user: Address) -> U256 {
        let principal = self.debt_principal.get(&user).unwrap_or_default();
        if principal == U256::zero() {
            return U256::zero();
        }

        let last_ts = self.last_accrual_ts.get(&user).unwrap_or(self.env().get_block_time());
        let now = self.env().get_block_time();

        if now <= last_ts {
            return principal;
        }

        let elapsed = now - last_ts;
        let interest = principal
            .checked_mul(U256::from(INTEREST_RATE_BPS))
            .and_then(|x| x.checked_mul(U256::from(elapsed)))
            .map(|x| x / U256::from(SECONDS_PER_YEAR as u128 * BPS_DIVISOR as u128))
            .unwrap_or_default();

        principal + interest
    }

    /// Batch delegation - accumulate deposits until MIN_DELEGATION_MOTES
    /// Note: Does NOT execute delegation immediately. Use force_delegate() to trigger.
    /// This avoids issues with delegation in the same transaction as deposit.
    fn batch_delegate(&mut self, amount: U512) {
        let pending = self.pending_to_delegate.get_or_default();
        let new_pending = pending + amount;
        self.pending_to_delegate.set(new_pending);
        // Delegation is now triggered manually via force_delegate() by owner
        // This avoids "DelegationAmountTooSmall" errors from same-tx delegation
    }

    /// Execute delegation to validator
    fn execute_delegate(&mut self, amount: U512) {
        let validator_key = self.validator_public_key.get_or_default();
        if validator_key.is_empty() {
            // No validator set, just track pending
            return;
        }

        // Check liquid balance
        let liquid = self.env().self_balance();
        let delegate_amount = amount.min(liquid);

        if delegate_amount >= U512::from(MIN_DELEGATION_MOTES) {
            let validator_pk = self.parse_validator_key(&validator_key);
            self.env().delegate(validator_pk, delegate_amount);

            let delegated = self.total_delegated.get_or_default();
            self.total_delegated.set(delegated + delegate_amount);
            self.pending_to_delegate.set(U512::zero());

            self.env().emit_event(events::DelegationBatched {
                amount_motes: delegate_amount,
            });
        }
    }

    // ==========================================
    // Unit Conversion
    // ==========================================

    /// Convert motes (U512, 9 decimals) to wad (U256, 18 decimals)
    /// 1 CSPR (1e9 motes) = 1e18 wad
    fn motes_to_wad(&self, motes: U512) -> U256 {
        let motes_u128 = motes.as_u128();
        U256::from(motes_u128) * U256::from(MOTES_TO_WAD_FACTOR)
    }

    /// Convert wad (U256, 18 decimals) to motes (U512, 9 decimals)
    /// Round down (conservative for protocol)
    #[allow(dead_code)]
    fn wad_to_motes(&self, wad: U256) -> U512 {
        let motes_u256 = wad / U256::from(MOTES_TO_WAD_FACTOR);
        U512::from(motes_u256.as_u128())
    }

    // ==========================================
    // Validator Key Parsing
    // ==========================================

    fn parse_validator_key(&self, validator_key: &str) -> PublicKey {
        let bytes = self.hex_decode(validator_key);
        if bytes.is_empty() {
            self.env().revert(VaultError::InvalidValidatorKey);
        }

        let algo_tag = bytes[0];
        let key_bytes = &bytes[1..];

        match algo_tag {
            0x01 => {
                if key_bytes.len() != 32 {
                    self.env().revert(VaultError::InvalidValidatorKey);
                }
                PublicKey::ed25519_from_bytes(key_bytes).unwrap_or_else(|_| {
                    self.env().revert(VaultError::InvalidValidatorKey)
                })
            }
            0x02 => {
                if key_bytes.len() != 33 {
                    self.env().revert(VaultError::InvalidValidatorKey);
                }
                PublicKey::secp256k1_from_bytes(key_bytes).unwrap_or_else(|_| {
                    self.env().revert(VaultError::InvalidValidatorKey)
                })
            }
            _ => self.env().revert(VaultError::InvalidValidatorKey),
        }
    }

    fn hex_decode(&self, hex_str: &str) -> Vec<u8> {
        if hex_str.len() % 2 != 0 {
            return Vec::new();
        }
        let mut bytes = Vec::with_capacity(hex_str.len() / 2);
        let mut chars = hex_str.chars();
        while let (Some(hi), Some(lo)) = (chars.next(), chars.next()) {
            let hi = match hi.to_digit(16) {
                Some(v) => v as u8,
                None => return Vec::new(),
            };
            let lo = match lo.to_digit(16) {
                Some(v) => v as u8,
                None => return Vec::new(),
            };
            bytes.push((hi << 4) | lo);
        }
        bytes
    }
}
