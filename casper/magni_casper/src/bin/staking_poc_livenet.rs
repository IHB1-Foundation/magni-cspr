//! Livenet test binary for StakingPoC (T11 Research Spike)
//!
//! Tests whether a stored contract (WASM) can directly call
//! Casper's native delegation/undelegation system.
//!
//! Run with: cargo run --bin staking_poc_livenet --features=livenet
//!
//! Required environment variables:
//! - ODRA_CASPER_LIVENET_SECRET_KEY_PATH: path to secret key file
//! - ODRA_CASPER_LIVENET_NODE_ADDRESS: Casper node address
//! - ODRA_CASPER_LIVENET_EVENTS_URL: events stream URL
//! - ODRA_CASPER_LIVENET_CHAIN_NAME: chain name (casper-test)
//!
//! Optional:
//! - STAKING_POC_VALIDATOR: validator public key (hex with 01/02 prefix)
//! - STAKING_POC_AMOUNT_CSPR: amount to stake in CSPR (default: 500, minimum for delegation)
//! - ODRA_CASPER_LIVENET_GAS: gas limit in motes

use odra::prelude::*;
use odra::host::{Deployer, HostRef, NoArgs};
use odra::casper_types::U512;

use magni_casper::staking_poc::{StakingPoC, StakingPoCHostRef};

const DEFAULT_DEPLOY_GAS_MOTES: u64 = 300_000_000_000; // 300 CSPR
const DEFAULT_CALL_GAS_MOTES: u64 = 100_000_000_000; // 100 CSPR
const MOTES_PER_CSPR: u64 = 1_000_000_000; // 1 CSPR = 1e9 motes

// Default testnet validator (from state_get_auction_info top validators)
const DEFAULT_VALIDATOR: &str = "012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80";

fn main() {
    println!("============================================");
    println!("  StakingPoC Livenet Test (T11 Research)");
    println!("============================================\n");

    // Initialize the livenet environment
    let env = odra_casper_livenet_env::env();
    let deploy_gas = read_u64_env("ODRA_CASPER_LIVENET_GAS", DEFAULT_DEPLOY_GAS_MOTES);
    let call_gas = read_u64_env("ODRA_CASPER_LIVENET_CALL_GAS", DEFAULT_CALL_GAS_MOTES);

    let caller = env.caller();
    println!("[INFO] Caller address: {:?}", caller);
    println!("[INFO] Gas config (motes): deploy={} ({} CSPR), calls={} ({} CSPR)",
        deploy_gas, deploy_gas / MOTES_PER_CSPR,
        call_gas, call_gas / MOTES_PER_CSPR
    );

    // Get validator and amount from env
    let validator = std::env::var("STAKING_POC_VALIDATOR")
        .unwrap_or_else(|_| DEFAULT_VALIDATOR.to_string());
    let stake_amount_cspr = read_u64_env("STAKING_POC_AMOUNT_CSPR", 500); // 500 CSPR minimum
    let stake_amount_motes = U512::from(stake_amount_cspr) * U512::from(MOTES_PER_CSPR);

    println!("[INFO] Validator: {}", validator);
    println!("[INFO] Stake amount: {} CSPR ({} motes)", stake_amount_cspr, stake_amount_motes);
    println!();

    // ==========================================
    // Step 1: Deploy StakingPoC contract
    // ==========================================
    println!("[STEP 1] Deploying StakingPoC contract...");
    env.set_gas(deploy_gas);
    let staking_poc = StakingPoC::deploy(&env, NoArgs);
    let contract_addr = staking_poc.address();
    println!("[OK] StakingPoC deployed at: {:?}", contract_addr);
    println!("     Owner: {:?}", staking_poc.owner());
    println!();

    // ==========================================
    // Step 2: Query initial delegated amount
    // ==========================================
    println!("[STEP 2] Querying initial delegated amount to validator...");
    env.set_gas(call_gas);
    let initial_delegated = staking_poc.delegated_amount(validator.clone());
    println!("[OK] Initial delegated amount: {} motes ({} CSPR)",
        initial_delegated,
        initial_delegated / U512::from(MOTES_PER_CSPR)
    );
    println!();

    // ==========================================
    // Step 3: Attempt to stake (delegate)
    // ==========================================
    println!("[STEP 3] Attempting to stake {} CSPR to validator...", stake_amount_cspr);
    println!("[INFO] This is the KEY TEST: does self.env().delegate() work on livenet?");
    println!();

    env.set_gas(call_gas);
    let mut staking_poc_mut = StakingPoCHostRef::new(contract_addr, env.clone());

    // CRITICAL: Attempt the stake call
    // This will either:
    // - Succeed: proving contracts can delegate on Casper 2.0
    // - Fail/Revert: proving contracts still cannot delegate
    let stake_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        staking_poc_mut
            .with_tokens(stake_amount_motes)
            .stake(validator.clone());
    }));

    match stake_result {
        Ok(_) => {
            println!("[SUCCESS] stake() call completed without revert!");
            println!();

            // Verify tracking
            let total_delegated = staking_poc_mut.total_delegated();
            println!("[INFO] Contract tracking total_delegated: {} motes", total_delegated);

            // Query actual delegation
            println!("[STEP 4] Verifying actual delegation via delegated_amount()...");
            let after_delegated = staking_poc_mut.delegated_amount(validator.clone());
            println!("[INFO] Delegated amount after stake: {} motes ({} CSPR)",
                after_delegated,
                after_delegated / U512::from(MOTES_PER_CSPR)
            );

            if after_delegated > initial_delegated {
                println!();
                println!("============================================");
                println!("  RESULT: DELEGATION FROM CONTRACT WORKS!");
                println!("============================================");
                println!();
                println!("The stake() call successfully delegated CSPR to the validator.");
                println!("This proves that Casper 2.0 / Odra 2.4 supports direct");
                println!("delegation from stored contracts (WASM).");
                println!();
                println!("RECOMMENDATION: Use Track A (on-chain delegation) for Magni.");
            } else {
                println!();
                println!("============================================");
                println!("  RESULT: CALL SUCCEEDED BUT NO DELEGATION");
                println!("============================================");
                println!();
                println!("The stake() call completed without error, but the delegated");
                println!("amount did not increase. This could mean:");
                println!("  - The delegation is pending (era boundary not reached)");
                println!("  - The delegation API is a no-op in the current env");
                println!();
                println!("RECOMMENDATION: Check state_get_auction_info via RPC:");
                println!("  casper-client query-state --node-address <NODE_URL> ...");
            }
        }
        Err(panic_info) => {
            println!("[FAILURE] stake() call panicked or reverted!");
            println!();
            println!("Panic info: {:?}", panic_info);
            println!();
            println!("============================================");
            println!("  RESULT: DELEGATION FROM CONTRACT FAILED");
            println!("============================================");
            println!();
            println!("The stake() call failed, indicating that contracts still");
            println!("cannot directly delegate on this network/version.");
            println!();
            println!("Possible causes:");
            println!("  - Main purse not accessible from contract context");
            println!("  - System contract call restrictions");
            println!("  - Entity model incompatibility");
            println!();
            println!("RECOMMENDATION: Use Track B1 (user direct delegation) or");
            println!("Track B2 (operator delegation) for Magni.");
        }
    }

    println!();
    println!("============================================");
    println!("  DEPLOYMENT INFO");
    println!("============================================");
    println!("StakingPoC contract: {:?}", contract_addr);
    println!("Validator: {}", validator);
    println!("Chain: {}", std::env::var("ODRA_CASPER_LIVENET_CHAIN_NAME").unwrap_or_default());
    println!();

    // Output JSON for scripting
    let chain_name = std::env::var("ODRA_CASPER_LIVENET_CHAIN_NAME")
        .unwrap_or_else(|_| "casper-test".to_string());
    let contract_hash = format_address_hash(&contract_addr);
    println!(
        r#"STAKING_POC_JSON={{"chain_name":"{}","contract_hash":"{}","validator":"{}","stake_amount_motes":"{}","result":"see_above"}}"#,
        chain_name,
        contract_hash,
        validator,
        stake_amount_motes
    );
}

fn read_u64_env(name: &str, default_value: u64) -> u64 {
    match std::env::var(name) {
        Ok(raw) => {
            let cleaned = raw.trim().replace('_', "");
            cleaned.parse::<u64>().unwrap_or(default_value)
        }
        Err(_) => default_value,
    }
}

fn format_address_hash(addr: &Address) -> String {
    let debug_str = format!("{:?}", addr);
    if let Some(start) = debug_str.find('[') {
        if let Some(end) = debug_str.rfind(']') {
            let bytes_str = &debug_str[start+1..end];
            let hex_parts: Vec<&str> = bytes_str.split(", ").collect();
            let mut result = String::new();
            for part in hex_parts {
                if let Some(hex) = part.strip_prefix("0x") {
                    result.push_str(hex);
                } else if let Some(hex) = part.strip_prefix("0X") {
                    result.push_str(hex);
                }
            }
            return result;
        }
    }
    debug_str
}
