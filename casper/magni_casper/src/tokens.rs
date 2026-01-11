//! CEP-18 Token implementations: tCSPR and mCSPR
//!
//! - tCSPR: Test token with faucet mint capability
//! - mCSPR: Synthetic token - only Magni (minter) can mint/burn

use odra::prelude::*;
use odra::casper_types::U256;

/// Events for CEP-18 tokens
pub mod events {
    use odra::prelude::*;
    use odra::casper_types::U256;

    #[odra::event]
    pub struct Transfer {
        pub from: Option<Address>,
        pub to: Option<Address>,
        pub amount: U256,
    }

    #[odra::event]
    pub struct Approval {
        pub owner: Address,
        pub spender: Address,
        pub amount: U256,
    }

    #[odra::event]
    pub struct MinterSet {
        pub old_minter: Option<Address>,
        pub new_minter: Address,
    }
}

/// Errors for token operations
#[odra::odra_error]
pub enum TokenError {
    InsufficientBalance = 1,
    InsufficientAllowance = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
}

/// tCSPR: Test CSPR token with faucet mint capability
/// Anyone can call faucet_mint to get test tokens
#[odra::module(events = [events::Transfer, events::Approval])]
pub struct TCSPRToken {
    name: Var<String>,
    symbol: Var<String>,
    decimals: Var<u8>,
    total_supply: Var<U256>,
    balances: Mapping<Address, U256>,
    allowances: Mapping<(Address, Address), U256>,
}

#[odra::module]
impl TCSPRToken {
    /// Initialize the token
    pub fn init(&mut self) {
        self.name.set("Test CSPR".to_string());
        self.symbol.set("tCSPR".to_string());
        self.decimals.set(18);
        self.total_supply.set(U256::zero());
    }

    /// Token name
    pub fn name(&self) -> String {
        self.name.get_or_default()
    }

    /// Token symbol
    pub fn symbol(&self) -> String {
        self.symbol.get_or_default()
    }

    /// Token decimals
    pub fn decimals(&self) -> u8 {
        self.decimals.get_or_default()
    }

    /// Total supply
    pub fn total_supply(&self) -> U256 {
        self.total_supply.get_or_default()
    }

    /// Balance of an address
    pub fn balance_of(&self, owner: Address) -> U256 {
        self.balances.get(&owner).unwrap_or_default()
    }

    /// Allowance from owner to spender
    pub fn allowance(&self, owner: Address, spender: Address) -> U256 {
        self.allowances.get(&(owner, spender)).unwrap_or_default()
    }

    /// Transfer tokens
    pub fn transfer(&mut self, to: Address, amount: U256) {
        let caller = self.env().caller();
        self._transfer(caller, to, amount);
    }

    /// Approve spender
    pub fn approve(&mut self, spender: Address, amount: U256) {
        let caller = self.env().caller();
        self.allowances.set(&(caller, spender), amount);
        self.env().emit_event(events::Approval {
            owner: caller,
            spender,
            amount,
        });
    }

    /// Transfer from (with allowance)
    pub fn transfer_from(&mut self, from: Address, to: Address, amount: U256) {
        let caller = self.env().caller();
        let current_allowance = self.allowance(from, caller);
        if current_allowance < amount {
            self.env().revert(TokenError::InsufficientAllowance);
        }
        self.allowances.set(&(from, caller), current_allowance - amount);
        self._transfer(from, to, amount);
    }

    /// Faucet mint - anyone can call to get test tokens
    pub fn faucet_mint(&mut self, to: Address, amount: U256) {
        self._mint(to, amount);
    }

    // Internal transfer
    fn _transfer(&mut self, from: Address, to: Address, amount: U256) {
        let from_balance = self.balance_of(from);
        if from_balance < amount {
            self.env().revert(TokenError::InsufficientBalance);
        }
        self.balances.set(&from, from_balance - amount);
        let to_balance = self.balance_of(to);
        self.balances.set(&to, to_balance + amount);
        self.env().emit_event(events::Transfer {
            from: Some(from),
            to: Some(to),
            amount,
        });
    }

    // Internal mint
    fn _mint(&mut self, to: Address, amount: U256) {
        let total = self.total_supply.get_or_default();
        self.total_supply.set(total + amount);
        let balance = self.balance_of(to);
        self.balances.set(&to, balance + amount);
        self.env().emit_event(events::Transfer {
            from: None,
            to: Some(to),
            amount,
        });
    }
}

/// mCSPR: Synthetic CSPR token - only Magni (minter) can mint/burn
#[odra::module(events = [events::Transfer, events::Approval, events::MinterSet])]
pub struct MCSPRToken {
    name: Var<String>,
    symbol: Var<String>,
    decimals: Var<u8>,
    total_supply: Var<U256>,
    balances: Mapping<Address, U256>,
    allowances: Mapping<(Address, Address), U256>,
    minter: Var<Address>,
}

#[odra::module]
impl MCSPRToken {
    /// Initialize the token with minter address
    pub fn init(&mut self, minter: Address) {
        self.name.set("Magni CSPR".to_string());
        self.symbol.set("mCSPR".to_string());
        self.decimals.set(18);
        self.total_supply.set(U256::zero());
        self.minter.set(minter);
        self.env().emit_event(events::MinterSet {
            old_minter: None,
            new_minter: minter,
        });
    }

    /// Get current minter
    pub fn minter(&self) -> Option<Address> {
        self.minter.get()
    }

    /// Set new minter (only current minter can call)
    pub fn set_minter(&mut self, new_minter: Address) {
        let caller = self.env().caller();
        let current_minter = self.minter.get();
        if current_minter != Some(caller) {
            self.env().revert(TokenError::Unauthorized);
        }
        self.minter.set(new_minter);
        self.env().emit_event(events::MinterSet {
            old_minter: current_minter,
            new_minter,
        });
    }

    /// Token name
    pub fn name(&self) -> String {
        self.name.get_or_default()
    }

    /// Token symbol
    pub fn symbol(&self) -> String {
        self.symbol.get_or_default()
    }

    /// Token decimals
    pub fn decimals(&self) -> u8 {
        self.decimals.get_or_default()
    }

    /// Total supply
    pub fn total_supply(&self) -> U256 {
        self.total_supply.get_or_default()
    }

    /// Balance of an address
    pub fn balance_of(&self, owner: Address) -> U256 {
        self.balances.get(&owner).unwrap_or_default()
    }

    /// Allowance from owner to spender
    pub fn allowance(&self, owner: Address, spender: Address) -> U256 {
        self.allowances.get(&(owner, spender)).unwrap_or_default()
    }

    /// Transfer tokens
    pub fn transfer(&mut self, to: Address, amount: U256) {
        let caller = self.env().caller();
        self._transfer(caller, to, amount);
    }

    /// Approve spender
    pub fn approve(&mut self, spender: Address, amount: U256) {
        let caller = self.env().caller();
        self.allowances.set(&(caller, spender), amount);
        self.env().emit_event(events::Approval {
            owner: caller,
            spender,
            amount,
        });
    }

    /// Transfer from (with allowance)
    pub fn transfer_from(&mut self, from: Address, to: Address, amount: U256) {
        let caller = self.env().caller();
        let current_allowance = self.allowance(from, caller);
        if current_allowance < amount {
            self.env().revert(TokenError::InsufficientAllowance);
        }
        self.allowances.set(&(from, caller), current_allowance - amount);
        self._transfer(from, to, amount);
    }

    /// Mint tokens (only minter can call)
    /// Uses package hash comparison to handle Casper 2.0 Entity/Package address mismatch
    pub fn mint(&mut self, to: Address, amount: U256) {
        let caller = self.env().caller();
        let minter = self.minter.get();

        // Compare by contract package hash only (not full Address)
        // This handles Casper 2.0 where cross-contract caller may have different Address representation
        let authorized = match (&minter, caller.as_contract_package_hash()) {
            (Some(m), Some(caller_pkg)) => {
                // Both are contracts - compare package hashes
                m.as_contract_package_hash() == Some(caller_pkg)
            }
            (Some(m), None) => {
                // Caller is account, minter is set - check exact match
                *m == caller
            }
            _ => false,
        };

        if !authorized {
            self.env().revert(TokenError::Unauthorized);
        }
        self._mint(to, amount);
    }

    /// Burn tokens (only minter can call, burns from target address)
    /// Uses package hash comparison to handle Casper 2.0 Entity/Package address mismatch
    pub fn burn(&mut self, from: Address, amount: U256) {
        let caller = self.env().caller();
        let minter = self.minter.get();

        // Compare by contract package hash only
        let authorized = match (&minter, caller.as_contract_package_hash()) {
            (Some(m), Some(caller_pkg)) => {
                m.as_contract_package_hash() == Some(caller_pkg)
            }
            (Some(m), None) => {
                *m == caller
            }
            _ => false,
        };

        if !authorized {
            self.env().revert(TokenError::Unauthorized);
        }
        self._burn(from, amount);
    }

    // Internal transfer
    fn _transfer(&mut self, from: Address, to: Address, amount: U256) {
        let from_balance = self.balance_of(from);
        if from_balance < amount {
            self.env().revert(TokenError::InsufficientBalance);
        }
        self.balances.set(&from, from_balance - amount);
        let to_balance = self.balance_of(to);
        self.balances.set(&to, to_balance + amount);
        self.env().emit_event(events::Transfer {
            from: Some(from),
            to: Some(to),
            amount,
        });
    }

    // Internal mint
    fn _mint(&mut self, to: Address, amount: U256) {
        let total = self.total_supply.get_or_default();
        self.total_supply.set(total + amount);
        let balance = self.balance_of(to);
        self.balances.set(&to, balance + amount);
        self.env().emit_event(events::Transfer {
            from: None,
            to: Some(to),
            amount,
        });
    }

    // Internal burn
    fn _burn(&mut self, from: Address, amount: U256) {
        let from_balance = self.balance_of(from);
        if from_balance < amount {
            self.env().revert(TokenError::InsufficientBalance);
        }
        self.balances.set(&from, from_balance - amount);
        let total = self.total_supply.get_or_default();
        self.total_supply.set(total - amount);
        self.env().emit_event(events::Transfer {
            from: Some(from),
            to: None,
            amount,
        });
    }
}

// Tests moved to tests/tokens_test.rs for proper Odra test integration
