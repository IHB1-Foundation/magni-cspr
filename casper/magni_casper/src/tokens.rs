//! CEP-18 Token implementations: tCSPR and mCSPR
//!
//! - tCSPR: Test token with faucet mint capability
//! - mCSPR: Synthetic token - only Magni (minter) can mint/burn

use alloc::string::String;
use odra::casper_types::U256;
use odra::prelude::*;
use odra_modules::cep18::events::{
    Burn, DecreaseAllowance, IncreaseAllowance, Mint, SetAllowance, Transfer, TransferFrom,
};
use odra_modules::cep18::storage::{
    Cep18AllowancesStorage, Cep18BalancesStorage, Cep18DecimalsStorage, Cep18NameStorage,
    Cep18SymbolStorage, Cep18TotalSupplyStorage,
};
use odra_modules::cep18_token::Cep18;

/// Extract 64-char hex hash from debug representation of Address
/// This helps compare addresses that may have different wrapper types in Casper 2.0
fn extract_hash_hex(debug_str: &str) -> Option<String> {
    // Look for a 64-char hex sequence in the string
    let chars: Vec<char> = debug_str.chars().collect();
    for i in 0..chars.len().saturating_sub(63) {
        let slice: String = chars[i..i + 64].iter().collect();
        if slice.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(slice.to_lowercase());
        }
    }
    None
}

/// Additional events for mCSPR
pub mod events {
    use odra::prelude::*;

    #[odra::event]
    pub struct MinterSet {
        pub old_minter: Option<Address>,
        pub new_minter: Address,
    }
}

/// Errors for token operations (aligned with CEP-18 codes where applicable)
#[odra::odra_error]
pub enum TokenError {
    InsufficientBalance = 60001,
    InsufficientAllowance = 60002,
    CannotTargetSelfUser = 60003,
    Unauthorized = 60004,
}

/// tCSPR: Test CSPR token with faucet mint capability
/// Anyone can call faucet_mint to get test tokens
#[odra::module(
    events = [
        Mint,
        Burn,
        SetAllowance,
        IncreaseAllowance,
        DecreaseAllowance,
        Transfer,
        TransferFrom
    ],
    errors = TokenError
)]
pub struct TCSPRToken {
    name: SubModule<Cep18NameStorage>,
    symbol: SubModule<Cep18SymbolStorage>,
    decimals: SubModule<Cep18DecimalsStorage>,
    total_supply: SubModule<Cep18TotalSupplyStorage>,
    balances: SubModule<Cep18BalancesStorage>,
    allowances: SubModule<Cep18AllowancesStorage>,
}

#[odra::module]
impl TCSPRToken {
    /// Initialize the token
    pub fn init(&mut self) {
        self.name.set("Test CSPR".to_string());
        self.symbol.set("tCSPR".to_string());
        self.decimals.set(18u8);
        self.total_supply.set(U256::zero());
        self.allowances.init();
        self.balances.init();
    }

    /// Token name
    pub fn name(&self) -> String {
        self.name.get()
    }

    /// Token symbol
    pub fn symbol(&self) -> String {
        self.symbol.get()
    }

    /// Token decimals
    pub fn decimals(&self) -> u8 {
        self.decimals.get()
    }

    /// Total supply
    pub fn total_supply(&self) -> U256 {
        self.total_supply.get()
    }

    /// Balance of an address
    pub fn balance_of(&self, owner: Address) -> U256 {
        self.balances.get(&owner).unwrap_or_default()
    }

    /// Allowance from owner to spender
    pub fn allowance(&self, owner: Address, spender: Address) -> U256 {
        self.allowances.get_or_default(&owner, &spender)
    }

    /// Transfer tokens
    pub fn transfer(&mut self, recipient: Address, amount: U256) {
        let sender = self.env().caller();
        if sender == recipient {
            self.env().revert(TokenError::CannotTargetSelfUser);
        }
        self.raw_transfer(&sender, &recipient, &amount);
        self.env().emit_event(Transfer {
            sender,
            recipient,
            amount,
        });
    }

    /// Approve spender
    pub fn approve(&mut self, spender: Address, amount: U256) {
        let owner = self.env().caller();
        if owner == spender {
            self.env().revert(TokenError::CannotTargetSelfUser);
        }
        self.allowances.set(&owner, &spender, amount);
        self.env().emit_event(SetAllowance {
            owner,
            spender,
            allowance: amount,
        });
    }

    /// Increase allowance
    pub fn increase_allowance(&mut self, spender: Address, amount: U256) {
        let owner = self.env().caller();
        if owner == spender {
            self.env().revert(TokenError::CannotTargetSelfUser);
        }
        let allowance = self.allowances.get_or_default(&owner, &spender);
        let new_allowance = allowance.saturating_add(amount);
        self.allowances.set(&owner, &spender, new_allowance);
        self.env().emit_event(IncreaseAllowance {
            owner,
            spender,
            allowance: new_allowance,
            inc_by: amount,
        });
    }

    /// Decrease allowance
    pub fn decrease_allowance(&mut self, spender: Address, amount: U256) {
        let owner = self.env().caller();
        if owner == spender {
            self.env().revert(TokenError::CannotTargetSelfUser);
        }
        let allowance = self.allowances.get_or_default(&owner, &spender);
        let new_allowance = allowance.saturating_sub(amount);
        self.allowances.set(&owner, &spender, new_allowance);
        self.env().emit_event(DecreaseAllowance {
            owner,
            spender,
            allowance: new_allowance,
            decr_by: amount,
        });
    }

    /// Transfer from (with allowance)
    pub fn transfer_from(&mut self, owner: Address, recipient: Address, amount: U256) {
        if owner == recipient {
            self.env().revert(TokenError::CannotTargetSelfUser);
        }
        if amount.is_zero() {
            return;
        }
        let spender = self.env().caller();
        let allowance = self.allowances.get_or_default(&owner, &spender);
        if allowance < amount {
            self.env().revert(TokenError::InsufficientAllowance);
        }
        self.allowances.set(&owner, &spender, allowance - amount);
        self.raw_transfer(&owner, &recipient, &amount);
        self.env().emit_event(TransferFrom {
            spender,
            owner,
            recipient,
            amount,
        });
    }

    /// Faucet mint - anyone can call to get test tokens
    pub fn faucet_mint(&mut self, to: Address, amount: U256) {
        self.raw_mint(&to, &amount);
    }

    // Internal transfer
    fn raw_transfer(&mut self, sender: &Address, recipient: &Address, amount: &U256) {
        let balance = self.balances.get(sender).unwrap_or_default();
        if balance < *amount {
            self.env().revert(TokenError::InsufficientBalance);
        }
        if !amount.is_zero() {
            self.balances.subtract(sender, *amount);
            self.balances.add(recipient, *amount);
        }
    }

    // Internal mint
    fn raw_mint(&mut self, owner: &Address, amount: &U256) {
        self.total_supply.add(*amount);
        self.balances.add(owner, *amount);
        self.env().emit_event(Mint {
            recipient: owner.clone(),
            amount: *amount,
        });
    }

    // Internal burn
    fn raw_burn(&mut self, owner: &Address, amount: &U256) {
        let balance = self.balances.get(owner).unwrap_or_default();
        if balance < *amount {
            self.env().revert(TokenError::InsufficientBalance);
        }
        self.balances.subtract(owner, *amount);
        self.total_supply.subtract(*amount);
        self.env().emit_event(Burn {
            owner: owner.clone(),
            amount: *amount,
        });
    }
}

/// mCSPR: Synthetic CSPR token - only Magni (minter) can mint/burn
#[odra::module(
    events = [
        Mint,
        Burn,
        SetAllowance,
        IncreaseAllowance,
        DecreaseAllowance,
        Transfer,
        TransferFrom,
        events::MinterSet
    ],
    errors = TokenError
)]
pub struct MCSPRToken {
    token: SubModule<Cep18>,
    minter: Var<Address>,
}

#[odra::module]
impl MCSPRToken {
    /// Initialize the token with minter address
    pub fn init(&mut self, minter: Address) {
        self.token.init("mCSPR".to_string(), "Magni CSPR".to_string(), 18u8, U256::zero());
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
        self.token.name()
    }

    /// Token symbol
    pub fn symbol(&self) -> String {
        self.token.symbol()
    }

    /// Token decimals
    pub fn decimals(&self) -> u8 {
        self.token.decimals()
    }

    /// Total supply
    pub fn total_supply(&self) -> U256 {
        self.token.total_supply()
    }

    /// Balance of an address
    pub fn balance_of(&self, owner: Address) -> U256 {
        self.token.balance_of(&owner)
    }

    /// Allowance from owner to spender
    pub fn allowance(&self, owner: Address, spender: Address) -> U256 {
        self.token.allowance(&owner, &spender)
    }

    /// Transfer tokens
    pub fn transfer(&mut self, recipient: Address, amount: U256) {
        self.token.transfer(&recipient, &amount);
    }

    /// Approve spender
    pub fn approve(&mut self, spender: Address, amount: U256) {
        self.token.approve(&spender, &amount);
    }

    /// Increase allowance
    pub fn increase_allowance(&mut self, spender: Address, amount: U256) {
        self.token.increase_allowance(&spender, &amount);
    }

    /// Decrease allowance
    pub fn decrease_allowance(&mut self, spender: Address, amount: U256) {
        self.token.decrease_allowance(&spender, &amount);
    }

    /// Transfer from (with allowance)
    pub fn transfer_from(&mut self, owner: Address, recipient: Address, amount: U256) {
        self.token.transfer_from(&owner, &recipient, &amount);
    }

    /// Mint tokens (only minter can call)
    /// Uses flexible comparison to handle Casper 2.0 Entity/Package address differences
    pub fn mint(&mut self, to: Address, amount: U256) {
        let caller = self.env().caller();
        if !self.is_authorized_minter(&caller) {
            self.env().revert(TokenError::Unauthorized);
        }
        self.token.raw_mint(&to, &amount);
    }

    /// Burn tokens (only minter can call, burns from target address)
    /// Uses flexible comparison to handle Casper 2.0 Entity/Package address differences
    pub fn burn(&mut self, from: Address, amount: U256) {
        let caller = self.env().caller();
        if !self.is_authorized_minter(&caller) {
            self.env().revert(TokenError::Unauthorized);
        }
        self.token.raw_burn(&from, &amount);
    }

    // Check if caller is authorized minter
    fn is_authorized_minter(&self, caller: &Address) -> bool {
        match self.minter.get() {
            Some(m) => {
                if &m == caller {
                    true
                } else if let (Some(m_pkg), Some(caller_pkg)) =
                    (m.as_contract_package_hash(), caller.as_contract_package_hash())
                {
                    m_pkg == caller_pkg
                } else {
                    let m_bytes = format!("{:?}", m);
                    let caller_bytes = format!("{:?}", caller);
                    extract_hash_hex(&m_bytes) == extract_hash_hex(&caller_bytes)
                }
            }
            None => false,
        }
    }
}

// Tests moved to tests/* for proper Odra test integration
