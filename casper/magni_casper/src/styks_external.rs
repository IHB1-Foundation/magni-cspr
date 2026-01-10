//! Styks Oracle External Contract Interface
//!
//! This module defines the external contract interface for reading price data
//! from the Styks Oracle on Casper.
//!
//! Environment variables:
//! - STYKS_PRICE_FEED_PACKAGE_HASH: The package hash of the Styks price feed contract
//! - STYKS_PRICE_FEED_ID: The feed ID to query for price data

use odra::prelude::*;
use odra::casper_types::U256;
use odra::ContractRef;

/// Styks Oracle External Contract Interface
///
/// This trait defines the interface for interacting with the Styks Oracle
/// to retrieve TWAP price data for various assets.
#[odra::external_contract]
pub trait StyksOracle {
    /// Get the TWAP (Time-Weighted Average Price) for a given feed ID
    ///
    /// # Arguments
    /// * `feed_id` - The unique identifier for the price feed
    ///
    /// # Returns
    /// The TWAP price as U256 (18 decimals), or None if not available
    fn get_twap_price(&self, feed_id: String) -> Option<U256>;

    /// Get the latest price for a given feed ID
    ///
    /// # Arguments
    /// * `feed_id` - The unique identifier for the price feed
    ///
    /// # Returns
    /// The latest price as U256 (18 decimals), or None if not available
    fn get_latest_price(&self, feed_id: String) -> Option<U256>;
}

/// Helper to create a Styks Oracle reference from a package hash
///
/// # Arguments
/// * `env` - The contract environment (wrapped in Rc)
/// * `package_hash_str` - The package hash as a hex string
///
/// # Returns
/// A reference to the Styks Oracle contract
pub fn create_styks_oracle_ref(env: Rc<ContractEnv>, package_hash_str: &str) -> StyksOracleContractRef {
    use odra::casper_types::contracts::ContractPackageHash;

    let package_hash = ContractPackageHash::from_formatted_str(package_hash_str)
        .expect("Invalid Styks package hash");

    StyksOracleContractRef::new(env, Address::Contract(package_hash))
}

/// Mock Styks Oracle for testing and demo purposes
/// Returns fixed prices when the real oracle is not available
pub mod mock {
    use super::*;

    /// Fixed CSPR/USD price for demo (1 CSPR = $0.02)
    /// Represented as 18 decimals: 0.02 * 10^18 = 20000000000000000
    pub const MOCK_CSPR_USD_PRICE: u128 = 20_000_000_000_000_000;

    /// Get a mock price for testing
    /// Returns a fixed price when oracle is not available
    pub fn get_mock_price() -> U256 {
        U256::from(MOCK_CSPR_USD_PRICE)
    }

    /// Check if we should use mock prices
    /// Returns true if oracle package hash is not set or is a test value
    pub fn should_use_mock(package_hash: Option<&str>) -> bool {
        match package_hash {
            None => true,
            Some(hash) => hash.is_empty() || hash == "mock" || hash.starts_with("0x0000"),
        }
    }
}
