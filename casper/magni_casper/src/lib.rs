//! Magni x Casper — Leverage Staking Prototype (Odra)
//!
//! This crate implements a leverage staking protocol on Casper using Odra framework.
//! - tCSPR: Test token with faucet mint
//! - mCSPR: Synthetic token mintable only by Magni
//! - Magni: Core leverage staking contract with Styks oracle integration

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

pub mod tokens;
pub mod styks_external;
pub mod magni;
pub mod staking_poc;
