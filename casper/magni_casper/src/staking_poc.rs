//! Staking PoC — Research Spike for T11
//!
//! This module tests whether a stored contract (WASM) can directly call
//! Casper's native delegation/undelegation system via Odra's staking API.
//!
//! Key questions:
//! 1. Does Odra 2.4 expose delegate/undelegate/delegated_amount on ContractEnv?
//! 2. Do these calls succeed on casper-test (livenet)?
//!
//! References:
//! - https://docs.odra.dev/advanced-features/staking
//! - https://medium.com/casper-association-r-d/casper-staking-from-smart-contract-2143df7752fc

use odra::prelude::*;
use odra::casper_types::{AsymmetricType, PublicKey, U512};
use alloc::vec::Vec;

/// Events for StakingPoC contract
pub mod events {
    use odra::prelude::*;
    use odra::casper_types::U512;

    #[odra::event]
    pub struct Staked {
        pub caller: Address,
        pub validator: String,
        pub amount: U512,
    }

    #[odra::event]
    pub struct UnstakeRequested {
        pub caller: Address,
        pub validator: String,
        pub amount: U512,
    }

    #[odra::event]
    pub struct DelegatedAmountQueried {
        pub validator: String,
        pub amount: U512,
    }
}

/// Errors for staking operations
#[odra::odra_error]
pub enum StakingPocError {
    ZeroAmount = 1,
    InvalidValidatorKey = 2,
    DelegationFailed = 3,
    UndelegationFailed = 4,
    InsufficientDelegation = 5,
}

/// StakingPoC: Minimal contract to test native CSPR delegation from a stored contract
///
/// This contract exists purely for research purposes (T11) to determine if
/// Casper 2.0 / Odra 2.4 allows WASM contracts to delegate to validators.
#[odra::module(events = [events::Staked, events::UnstakeRequested, events::DelegatedAmountQueried])]
pub struct StakingPoC {
    /// Owner of the contract (for restricted operations)
    owner: Var<Address>,
    /// Total amount delegated through this contract (tracking)
    total_delegated: Var<U512>,
}

#[odra::module]
impl StakingPoC {
    /// Initialize the StakingPoC contract
    pub fn init(&mut self) {
        self.owner.set(self.env().caller());
        self.total_delegated.set(U512::zero());
    }

    /// Parse a validator public key from hex string
    ///
    /// Format: "01..." for Ed25519 (66 hex chars), "02..." for Secp256k1 (68 hex chars)
    fn parse_validator_key(&self, validator_public_key: &str) -> PublicKey {
        // Decode hex string to bytes
        let bytes = self.hex_decode(validator_public_key);

        if bytes.is_empty() {
            self.env().revert(StakingPocError::InvalidValidatorKey);
        }

        // First byte indicates algorithm
        let algo_tag = bytes[0];
        let key_bytes = &bytes[1..];

        match algo_tag {
            0x01 => {
                // Ed25519: 32 bytes
                if key_bytes.len() != 32 {
                    self.env().revert(StakingPocError::InvalidValidatorKey);
                }
                PublicKey::ed25519_from_bytes(key_bytes).unwrap_or_else(|_| {
                    self.env().revert(StakingPocError::InvalidValidatorKey)
                })
            }
            0x02 => {
                // Secp256k1: 33 bytes
                if key_bytes.len() != 33 {
                    self.env().revert(StakingPocError::InvalidValidatorKey);
                }
                PublicKey::secp256k1_from_bytes(key_bytes).unwrap_or_else(|_| {
                    self.env().revert(StakingPocError::InvalidValidatorKey)
                })
            }
            _ => {
                self.env().revert(StakingPocError::InvalidValidatorKey)
            }
        }
    }

    /// Decode hex string to bytes (simple implementation)
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

    /// Stake CSPR to a validator
    ///
    /// The caller must attach CSPR (payable). The contract then attempts
    /// to delegate this amount to the specified validator via Odra's
    /// `self.env().delegate()` API.
    ///
    /// # Arguments
    /// * `validator_public_key` - The validator's public key (hex string, with prefix e.g. "01...")
    ///
    /// # Note
    /// Minimum delegation on Casper is 500 CSPR = 500_000_000_000 motes
    #[odra(payable)]
    pub fn stake(&mut self, validator_public_key: String) {
        let amount = self.env().attached_value();

        // Validate amount (minimum 500 CSPR = 500e9 motes)
        if amount == U512::zero() {
            self.env().revert(StakingPocError::ZeroAmount);
        }

        // Validate and parse validator key
        if validator_public_key.is_empty() {
            self.env().revert(StakingPocError::InvalidValidatorKey);
        }
        let validator_pk = self.parse_validator_key(&validator_public_key);

        let caller = self.env().caller();

        // Attempt to delegate via Odra's staking API
        // This is the key test: does this work on livenet?
        self.env().delegate(validator_pk, amount);

        // Update tracking
        let current = self.total_delegated.get_or_default();
        self.total_delegated.set(current + amount);

        // Emit event
        self.env().emit_event(events::Staked {
            caller,
            validator: validator_public_key,
            amount,
        });
    }

    /// Request to unstake CSPR from a validator
    ///
    /// # Arguments
    /// * `validator_public_key` - The validator's public key (hex string)
    /// * `amount` - Amount of motes to undelegate
    ///
    /// # Note
    /// Undelegation has a ~14 hour delay (7 eras) on Casper.
    pub fn request_unstake(&mut self, validator_public_key: String, amount: U512) {
        if amount == U512::zero() {
            self.env().revert(StakingPocError::ZeroAmount);
        }

        if validator_public_key.is_empty() {
            self.env().revert(StakingPocError::InvalidValidatorKey);
        }
        let validator_pk = self.parse_validator_key(&validator_public_key);

        let caller = self.env().caller();

        // Attempt to undelegate via Odra's staking API
        self.env().undelegate(validator_pk, amount);

        // Update tracking
        let current = self.total_delegated.get_or_default();
        if current >= amount {
            self.total_delegated.set(current - amount);
        }

        // Emit event
        self.env().emit_event(events::UnstakeRequested {
            caller,
            validator: validator_public_key,
            amount,
        });
    }

    /// Query the amount currently delegated to a validator by this contract
    ///
    /// # Arguments
    /// * `validator_public_key` - The validator's public key (hex string)
    ///
    /// # Returns
    /// Amount in motes (U512)
    pub fn delegated_amount(&self, validator_public_key: String) -> U512 {
        if validator_public_key.is_empty() {
            return U512::zero();
        }
        let validator_pk = self.parse_validator_key(&validator_public_key);

        let amount = self.env().delegated_amount(validator_pk);

        // Emit event for debugging
        self.env().emit_event(events::DelegatedAmountQueried {
            validator: validator_public_key,
            amount,
        });

        amount
    }

    /// Get total amount delegated through this contract (internal tracking)
    pub fn total_delegated(&self) -> U512 {
        self.total_delegated.get_or_default()
    }

    /// Get the contract owner
    pub fn owner(&self) -> Option<Address> {
        self.owner.get()
    }
}

// Tests moved to tests/ directory for better separation
// Unit tests for staking_poc are handled via livenet verification (T11)
