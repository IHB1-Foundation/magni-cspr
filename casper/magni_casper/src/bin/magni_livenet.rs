//! Livenet deploy and demo binary for Magni V2 CSPR Vault.
//!
//! This binary is intended to be run from `casper/scripts/*` which loads `casper/.env`.
//!
//! Run with:
//! - Deploy only:           MAGNI_LIVENET_MODE=deploy cargo run --bin magni_livenet --features=livenet
//! - Deploy + demo:         MAGNI_LIVENET_MODE=deploy_and_demo cargo run --bin magni_livenet --features=livenet
//! - Demo on existing:      MAGNI_LIVENET_MODE=demo MAGNI_EXISTING_MAGNI=... MAGNI_EXISTING_MCSPR=... cargo run ...
//! - Finalize withdraw:     MAGNI_LIVENET_MODE=finalize MAGNI_EXISTING_MAGNI=... MAGNI_EXISTING_MCSPR=... cargo run ...
//!
//! Required environment variables (Odra livenet):
//! - ODRA_CASPER_LIVENET_SECRET_KEY_PATH
//! - ODRA_CASPER_LIVENET_NODE_ADDRESS        (base URL; Odra appends "/rpc")
//! - ODRA_CASPER_LIVENET_EVENTS_URL          (required by Odra; placeholder URL is OK here)
//! - ODRA_CASPER_LIVENET_CHAIN_NAME
//!
//! Optional:
//! - DEFAULT_VALIDATOR_PUBLIC_KEY            (hex public key with 01/02 prefix)
//! - ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN    (motes)
//! - ODRA_CASPER_LIVENET_DEPLOY_GAS_MAGNI    (motes)
//! - ODRA_CASPER_LIVENET_CALL_GAS            (motes)
//! - ODRA_CASPER_LIVENET_GAS                 (legacy fallback; motes)
//! - MAGNI_EXISTING_MCSPR                    (64-hex or formatted "hash-..."/"contract-package-...")
//! - MAGNI_EXISTING_MAGNI                    (64-hex or formatted "hash-..."/"contract-package-...")
//! - MAGNI_DEMO_DEPOSIT_CSPR                 (default: 100)
//! - MAGNI_DEMO_BORROW_CSPR                  (default: 50 -- will be converted to wad)
//! - MAGNI_DEMO_REQUEST_WITHDRAW             ("1" to request withdraw after borrow; default: 1)

use odra::host::{Deployer, HostRef};
use odra::prelude::*;
use odra::casper_types::{U256, U512};

use magni_casper::magni::{Magni, MagniHostRef, MagniInitArgs};
use magni_casper::tokens::{MCSPRToken, MCSPRTokenHostRef, MCSPRTokenInitArgs};

const MOTES_PER_CSPR: u64 = 1_000_000_000;
const MOTES_TO_WAD_FACTOR: u128 = 1_000_000_000; // 1e9

const DEFAULT_VALIDATOR_PUBLIC_KEY: &str =
    "012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80";

const DEFAULT_DEPLOY_GAS_TOKEN_MOTES: u64 = 450_000_000_000; // 450 CSPR
const DEFAULT_DEPLOY_GAS_MAGNI_MOTES: u64 = 600_000_000_000; // 600 CSPR
const DEFAULT_CALL_GAS_MOTES: u64 = 50_000_000_000; // 50 CSPR

/// Convert motes (U512, 9 decimals) to wad (U256, 18 decimals)
fn motes_to_wad(motes: U512) -> U256 {
    let motes_u128 = motes.as_u128();
    U256::from(motes_u128) * U256::from(MOTES_TO_WAD_FACTOR)
}

fn main() {
    println!("============================================");
    println!("  Magni V2 CSPR Vault — Livenet");
    println!("============================================\n");

    let env = odra_casper_livenet_env::env();

    let mode = std::env::var("MAGNI_LIVENET_MODE").unwrap_or_else(|_| "deploy".to_string());
    let should_deploy = mode == "deploy" || mode == "deploy_and_demo";
    let should_demo = mode == "demo" || mode == "deploy_and_demo";
    let should_finalize = mode == "finalize";
    let should_query = mode == "query";

    let gas_fallback = read_u64_env("ODRA_CASPER_LIVENET_GAS", DEFAULT_DEPLOY_GAS_TOKEN_MOTES);
    let deploy_gas_token = read_u64_env("ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN", gas_fallback);
    let deploy_gas_magni = read_u64_env("ODRA_CASPER_LIVENET_DEPLOY_GAS_MAGNI", DEFAULT_DEPLOY_GAS_MAGNI_MOTES);
    let call_gas = read_u64_env("ODRA_CASPER_LIVENET_CALL_GAS", DEFAULT_CALL_GAS_MOTES);

    let validator_public_key = std::env::var("DEFAULT_VALIDATOR_PUBLIC_KEY")
        .unwrap_or_else(|_| DEFAULT_VALIDATOR_PUBLIC_KEY.to_string());

    let deposit_cspr = read_u64_env("MAGNI_DEMO_DEPOSIT_CSPR", 100);
    let borrow_cspr = read_u64_env("MAGNI_DEMO_BORROW_CSPR", 50);
    let request_withdraw = std::env::var("MAGNI_DEMO_REQUEST_WITHDRAW")
        .map(|v| v.trim() != "0" && !v.trim().is_empty())
        .unwrap_or(true);

    let deposit_motes = U512::from(deposit_cspr) * U512::from(MOTES_PER_CSPR);
    let borrow_wad = motes_to_wad(U512::from(borrow_cspr) * U512::from(MOTES_PER_CSPR));

    println!("[INFO] Mode: {}", mode);
    println!("[INFO] Caller: {:?}", env.caller());
    println!(
        "[INFO] Gas (motes): deploy_token={} ({} CSPR), deploy_magni={} ({} CSPR), calls={} ({} CSPR)",
        deploy_gas_token,
        deploy_gas_token / MOTES_PER_CSPR,
        deploy_gas_magni,
        deploy_gas_magni / MOTES_PER_CSPR,
        call_gas,
        call_gas / MOTES_PER_CSPR
    );
    println!("[INFO] Validator public key: {}", validator_public_key);
    println!(
        "[INFO] Demo params: deposit={} CSPR, borrow={} CSPR, request_withdraw={}",
        deposit_cspr, borrow_cspr, request_withdraw
    );
    println!();

    // ==========================================
    // Step 1: Deploy (or reuse) mCSPR
    // ==========================================
    let mcspr_addr = if should_deploy {
        println!("[STEP 1] Deploying mCSPR token...");
        env.set_gas(deploy_gas_token);
        let mcspr = MCSPRToken::deploy(&env, MCSPRTokenInitArgs { minter: env.caller() });
        let addr = mcspr.address();
        println!("[OK] mCSPR deployed at: {:?}", addr);
        println!("     Name: {}", mcspr.name());
        println!("     Symbol: {}", mcspr.symbol());
        println!("     Minter: {:?}", mcspr.minter());
        println!();
        addr
    } else {
        println!("[STEP 1] Reusing existing mCSPR token...");
        let raw = std::env::var("MAGNI_EXISTING_MCSPR")
            .unwrap_or_else(|_| panic!("MAGNI_EXISTING_MCSPR must be set for mode={}", mode));
        let addr = parse_contract_address(&raw);
        println!("[OK] mCSPR: {:?}", addr);
        println!();
        addr
    };

    // ==========================================
    // Step 2: Deploy (or reuse) Magni V2
    // ==========================================
    let magni_addr = if should_deploy {
        println!("[STEP 2] Deploying Magni V2 Vault contract...");
        env.set_gas(deploy_gas_magni);
        let magni = Magni::deploy(
            &env,
            MagniInitArgs {
                mcspr: mcspr_addr,
                validator_public_key: validator_public_key.clone(),
            },
        );
        let addr = magni.address();
        println!("[OK] Magni V2 deployed at: {:?}", addr);
        println!("     mCSPR: {:?}", magni.mcspr());
        println!("     Validator public key: {}", magni.validator_public_key());
        println!();
        addr
    } else {
        println!("[STEP 2] Reusing existing Magni V2 contract...");
        let raw = std::env::var("MAGNI_EXISTING_MAGNI")
            .unwrap_or_else(|_| panic!("MAGNI_EXISTING_MAGNI must be set for mode={}", mode));
        let addr = parse_contract_address(&raw);
        println!("[OK] Magni V2: {:?}", addr);
        println!();
        addr
    };

    // ==========================================
    // Step 3: Set mCSPR minter to Magni (best-effort, skip in query mode)
    // ==========================================
    let mcspr = if should_query {
        println!("[STEP 3] Skipping minter check (query mode)...");
        MCSPRTokenHostRef::new(mcspr_addr, env.clone())
    } else {
        println!("[STEP 3] Ensuring mCSPR minter is Magni...");
        env.set_gas(call_gas);
        let mut mcspr = MCSPRTokenHostRef::new(mcspr_addr, env.clone());
        let current_minter = mcspr.minter();
        if current_minter == Some(magni_addr) {
            println!("[OK] mCSPR minter already set to Magni.");
        } else {
            // This will only succeed if the caller is the current minter (typically during fresh deploy).
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                mcspr.set_minter(magni_addr);
            }));
            match res {
                Ok(_) => println!("[OK] mCSPR minter updated to: {:?}", mcspr.minter()),
                Err(_) => println!(
                    "[WARN] Could not update minter (current={:?}). If this is a reused deployment, ensure mCSPR minter is Magni.",
                    current_minter
                ),
            }
        }
        mcspr
    };
    println!();

    // ==========================================
    // Demo: V2 flow (deposit -> borrow -> request_withdraw -> finalize)
    // ==========================================
    if should_demo || should_finalize {
        let mut magni = MagniHostRef::new(magni_addr, env.clone());
        let caller = env.caller();

        if should_demo {
            println!("[DEMO 1] Depositing {} CSPR as collateral...", deposit_cspr);
            env.set_gas(call_gas);
            magni.with_tokens(deposit_motes).deposit();
            println!("[OK] Deposit complete.");
            print_position_info(&magni, caller, &mcspr);

            println!("[DEMO 2] Borrowing {} mCSPR...", borrow_cspr);
            env.set_gas(call_gas);
            magni.borrow(borrow_wad);
            println!("[OK] Borrow complete.");
            print_position_info(&magni, caller, &mcspr);

            if request_withdraw {
                // Calculate max safe withdraw (must keep LTV <= 80%)
                // debt_wad <= remaining_collateral_wad * 0.8
                // remaining_collateral_wad >= debt_wad / 0.8
                // remaining_collateral_wad >= debt_wad * 10 / 8
                // withdraw_wad = collateral_wad - remaining_collateral_wad
                // withdraw_wad = collateral_wad - (debt_wad * 10 / 8)

                let pos = magni.get_position(caller);
                let min_collateral_wad = pos.debt_wad * U256::from(10u64) / U256::from(8u64);
                let max_withdraw_wad = if pos.collateral_wad > min_collateral_wad {
                    pos.collateral_wad - min_collateral_wad
                } else {
                    U256::zero()
                };

                // Convert to motes (divide by 1e9)
                let max_withdraw_motes = U512::from((max_withdraw_wad / U256::from(MOTES_TO_WAD_FACTOR)).as_u128());

                // Withdraw half of max safe amount for demo
                let withdraw_motes = max_withdraw_motes / 2;

                if withdraw_motes > U512::zero() {
                    let withdraw_cspr = withdraw_motes.as_u64() / MOTES_PER_CSPR;
                    println!("[DEMO 3] Requesting withdrawal of {} CSPR...", withdraw_cspr);
                    env.set_gas(call_gas);
                    magni.request_withdraw(withdraw_motes);
                    println!("[OK] Withdraw requested. Status: {}", magni.status_of(caller));
                    print_position_info(&magni, caller, &mcspr);
                    println!("[INFO] To finalize withdrawal, run with MAGNI_LIVENET_MODE=finalize after unbonding (~14h).");
                } else {
                    println!("[SKIP] Cannot withdraw - would exceed LTV limit.");
                }
            }
        }

        if should_finalize {
            println!("[DEMO] Finalizing withdrawal...");
            let status = magni.status_of(caller);
            if status != 2 {
                println!("[WARN] Vault not in Withdrawing state (status={}). Skipping.", status);
            } else {
                env.set_gas(call_gas);
                magni.finalize_withdraw();
                println!("[OK] Withdrawal finalized.");
                print_position_info(&magni, caller, &mcspr);
            }
        }
    }

    // ==========================================
    // Query mode: Output position as JSON
    // ==========================================
    if should_query {
        let magni = MagniHostRef::new(magni_addr, env.clone());

        // Get the user address to query (default: caller)
        // For now, always query the caller (the key owner)
        let query_user = env.caller();

        let pos = magni.get_position(query_user);
        let mcspr_balance = mcspr.balance_of(query_user);

        // Output as JSON to stdout
        println!("MAGNI_POSITION_JSON={{\"collateral_motes\":\"{}\",\"collateral_wad\":\"{}\",\"debt_wad\":\"{}\",\"ltv_bps\":{},\"health_factor\":{},\"pending_withdraw_motes\":\"{}\",\"status\":{},\"mcspr_balance\":\"{}\",\"user\":\"{:?}\"}}",
            pos.collateral_motes,
            pos.collateral_wad,
            pos.debt_wad,
            pos.ltv_bps,
            pos.health_factor,
            pos.pending_withdraw_motes,
            pos.status,
            mcspr_balance,
            query_user
        );
        return;
    }

    output_deploy_json(mcspr_addr, magni_addr, validator_public_key);
}

fn print_position_info(magni: &MagniHostRef, user: Address, mcspr: &MCSPRTokenHostRef) {
    let pos = magni.get_position(user);
    let status_str = match pos.status {
        0 => "None",
        1 => "Active",
        2 => "Withdrawing",
        _ => "Unknown",
    };
    println!("     collateral: {} motes ({} CSPR)", pos.collateral_motes, pos.collateral_motes.as_u64() / MOTES_PER_CSPR);
    println!("     debt: {} wad", pos.debt_wad);
    println!("     ltv: {} bps ({}%)", pos.ltv_bps, pos.ltv_bps as f64 / 100.0);
    println!("     health_factor: {}", pos.health_factor);
    println!("     pending_withdraw: {} motes", pos.pending_withdraw_motes);
    println!("     status: {} ({})", pos.status, status_str);
    println!("     total_collateral: {}", magni.total_collateral());
    println!("     total_debt: {}", magni.total_debt());
    println!("     pending_to_delegate: {}", magni.pending_to_delegate());
    println!("     total_delegated: {}", magni.total_delegated());
    println!("     liquid_balance: {}", magni.liquid_balance());
    println!("     user mCSPR balance: {}", mcspr.balance_of(user));
    println!();
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

fn output_deploy_json(mcspr_addr: Address, magni_addr: Address, validator_public_key: String) {
    let chain_name =
        std::env::var("ODRA_CASPER_LIVENET_CHAIN_NAME").unwrap_or_else(|_| "casper-test".to_string());
    let node_url = std::env::var("ODRA_CASPER_LIVENET_NODE_ADDRESS")
        .unwrap_or_else(|_| "https://node.testnet.casper.network".to_string());

    let mcspr_hash = format_address_hash(&mcspr_addr);
    let magni_hash = format_address_hash(&magni_addr);

    println!(
        r#"MAGNI_DEPLOY_JSON={{"chain_name":"{}","node_url":"{}","mcspr_contract_hash":"{}","magni_contract_hash":"{}","validator_public_key":"{}","deployed_at":"{}"}}"#,
        chain_name,
        node_url,
        mcspr_hash,
        magni_hash,
        validator_public_key,
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ")
    );
}

fn format_address_hash(addr: &Address) -> String {
    let debug_str = format!("{:?}", addr);
    if let Some(start) = debug_str.find('[') {
        if let Some(end) = debug_str.rfind(']') {
            let bytes_str = &debug_str[start + 1..end];
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

fn parse_contract_address(raw: &str) -> Address {
    use std::str::FromStr;
    let trimmed = raw.trim();
    let cleaned = trimmed
        .strip_prefix("hash-")
        .or_else(|| trimmed.strip_prefix("contract-package-"))
        .or_else(|| trimmed.strip_prefix("package-"))
        .or_else(|| trimmed.strip_prefix("account-hash-"))
        .unwrap_or(trimmed)
        .trim();

    if cleaned.len() == 64 && cleaned.chars().all(|c| c.is_ascii_hexdigit()) {
        Address::from_str(&format!("hash-{}", cleaned))
            .unwrap_or_else(|_| panic!("Invalid contract hash (expected 64 hex): {}", trimmed))
    } else {
        Address::from_str(trimmed).unwrap_or_else(|_| panic!("Invalid address format: {}", trimmed))
    }
}
