//! Build contract binary for Odra WASM generation
//!
//! This binary is compiled to WASM and contains the contract entry points.

#![cfg_attr(target_arch = "wasm32", no_std)]
#![cfg_attr(target_arch = "wasm32", no_main)]

#[cfg(target_arch = "wasm32")]
extern crate odra_casper_wasm_env;

#[cfg(target_arch = "wasm32")]
use magni_casper::magni::Magni;
#[cfg(target_arch = "wasm32")]
use magni_casper::staking_poc::StakingPoC;
#[cfg(target_arch = "wasm32")]
use magni_casper::tokens::{MCSPRToken, TCSPRToken};
#[cfg(target_arch = "wasm32")]
use odra_casper_wasm_env as _;

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    panic!("magni_casper_build_contract is intended to be built for wasm32-unknown-unknown only");
}
