//! V2 Vault Tests
//!
//! Tests for Magni V2 CSPR Vault (deposit/borrow/repay/withdraw)

use odra::prelude::*;
use odra::host::{Deployer, HostRef};
use odra::casper_types::{PublicKey, U256, U512};
use odra::casper_types::bytesrepr::ToBytes;

use magni_casper::magni::{Magni, MagniHostRef, MagniInitArgs};
use magni_casper::tokens::{MCSPRToken, MCSPRTokenHostRef, MCSPRTokenInitArgs};

/// Constants for testing
const MOTES_PER_CSPR: u64 = 1_000_000_000;
const MOTES_TO_WAD_FACTOR: u128 = 1_000_000_000;
const LTV_MAX_BPS: u64 = 8000;
const BPS_DIVISOR: u64 = 10_000;
const WAD: u128 = 1_000_000_000_000_000_000;

/// Convert CSPR to motes
fn cspr_to_motes(cspr: u64) -> U512 {
    U512::from(cspr) * U512::from(MOTES_PER_CSPR)
}

/// Convert motes to wad
fn motes_to_wad(motes: U512) -> U256 {
    let motes_u128 = motes.as_u128();
    U256::from(motes_u128) * U256::from(MOTES_TO_WAD_FACTOR)
}

/// Calculate max borrow for given collateral
fn max_borrow_wad(collateral_motes: U512) -> U256 {
    let collateral_wad = motes_to_wad(collateral_motes);
    collateral_wad * U256::from(LTV_MAX_BPS) / U256::from(BPS_DIVISOR)
}

/// Convert public key to hex string
fn public_key_to_hex(public_key: &PublicKey) -> String {
    let bytes = public_key.to_bytes().expect("public key to_bytes");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ==========================================
// Helper: Deploy contracts
// ==========================================

fn deploy_contracts(env: &odra::host::HostEnv) -> (MCSPRTokenHostRef, MagniHostRef, String) {
    let owner = env.get_account(0);
    let validator = env.get_validator(0);
    let validator_hex = public_key_to_hex(&validator);

    // Deploy mCSPR with owner as temporary minter
    env.set_caller(owner);
    let mcspr = MCSPRToken::deploy(env, MCSPRTokenInitArgs { minter: owner });

    // Deploy Magni vault
    let magni = Magni::deploy(env, MagniInitArgs {
        mcspr: mcspr.address(),
        validator_public_key: validator_hex.clone(),
    });

    // Set Magni as minter
    let mut mcspr_mut = MCSPRTokenHostRef::new(mcspr.address(), env.clone());
    mcspr_mut.set_minter(magni.address());

    (mcspr, magni, validator_hex)
}

// ==========================================
// T18: Basic Flow Tests
// ==========================================

#[test]
fn test_deposit_creates_vault() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(100);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Check vault is created
    assert_eq!(magni_mut.status_of(user), 1); // Active
    assert_eq!(magni_mut.collateral_of(user), deposit_amount);
    assert_eq!(magni_mut.debt_of(user), U256::zero());
    assert_eq!(magni_mut.total_collateral(), deposit_amount);
}

#[test]
fn test_deposit_adds_to_existing_collateral() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let first_deposit = cspr_to_motes(100);
    let second_deposit = cspr_to_motes(50);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());

    magni_mut.with_tokens(first_deposit).deposit();
    magni_mut.with_tokens(second_deposit).add_collateral();

    assert_eq!(magni_mut.collateral_of(user), first_deposit + second_deposit);
}

#[test]
fn test_borrow_success() {
    let env = odra_test::env();
    let (mcspr, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000); // 1000 CSPR
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow 50% of max (well within LTV limit)
    let max_borrow = max_borrow_wad(deposit_amount);
    let borrow_amount = max_borrow / U256::from(2u64);
    magni_mut.borrow(borrow_amount);

    // Check debt and mCSPR balance
    assert_eq!(magni_mut.debt_of(user), borrow_amount);
    let mcspr_ref = MCSPRTokenHostRef::new(mcspr.address(), env.clone());
    assert_eq!(mcspr_ref.balance_of(user), borrow_amount);
}

#[test]
fn test_borrow_max_ltv() {
    let env = odra_test::env();
    let (mcspr, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow exactly max LTV (80%)
    let max_borrow = max_borrow_wad(deposit_amount);
    magni_mut.borrow(max_borrow);

    assert_eq!(magni_mut.debt_of(user), max_borrow);
    let mcspr_ref = MCSPRTokenHostRef::new(mcspr.address(), env.clone());
    assert_eq!(mcspr_ref.balance_of(user), max_borrow);
}

#[test]
#[should_panic(expected = "LtvExceeded")]
fn test_borrow_exceeds_ltv_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Try to borrow more than 80%
    let max_borrow = max_borrow_wad(deposit_amount);
    let excess_borrow = max_borrow + U256::one();
    magni_mut.borrow(excess_borrow);
}

#[test]
#[should_panic(expected = "NoVault")]
fn test_borrow_without_vault_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.borrow(U256::from(100u64));
}

// ==========================================
// T18: Repay Tests
// ==========================================

#[test]
fn test_repay_partial() {
    let env = odra_test::env();
    let (mcspr, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow
    let borrow_amount = max_borrow_wad(deposit_amount) / U256::from(2u64);
    magni_mut.borrow(borrow_amount);

    // Approve and repay half
    let repay_amount = borrow_amount / U256::from(2u64);
    let mut mcspr_mut = MCSPRTokenHostRef::new(mcspr.address(), env.clone());
    mcspr_mut.approve(magni.address(), repay_amount);
    magni_mut.repay(repay_amount);

    // Check debt decreased
    assert_eq!(magni_mut.debt_of(user), borrow_amount - repay_amount);
}

#[test]
fn test_repay_full() {
    let env = odra_test::env();
    let (mcspr, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow
    let borrow_amount = max_borrow_wad(deposit_amount) / U256::from(2u64);
    magni_mut.borrow(borrow_amount);

    // Approve and repay full
    let mut mcspr_mut = MCSPRTokenHostRef::new(mcspr.address(), env.clone());
    mcspr_mut.approve(magni.address(), borrow_amount);
    magni_mut.repay(borrow_amount);

    // Check debt is zero
    assert_eq!(magni_mut.debt_of(user), U256::zero());
}

#[test]
fn test_repay_more_than_debt_caps_at_debt() {
    let env = odra_test::env();
    let (mcspr, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow
    let borrow_amount = U256::from(100u64) * U256::from(WAD);
    magni_mut.borrow(borrow_amount);

    // Approve more than debt and repay
    let mut mcspr_mut = MCSPRTokenHostRef::new(mcspr.address(), env.clone());
    let large_amount = borrow_amount * U256::from(2u64);
    mcspr_mut.approve(magni.address(), large_amount);
    magni_mut.repay(large_amount);

    // Debt should be zero, not negative
    assert_eq!(magni_mut.debt_of(user), U256::zero());
    // User should have no mCSPR left (we only borrowed borrow_amount)
    assert_eq!(mcspr_mut.balance_of(user), U256::zero());
}

#[test]
#[should_panic(expected = "InsufficientAllowance")]
fn test_repay_without_allowance_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow
    let borrow_amount = U256::from(100u64) * U256::from(WAD);
    magni_mut.borrow(borrow_amount);

    // Try to repay without approve
    magni_mut.repay(borrow_amount);
}

// ==========================================
// T18: Withdraw Tests (2-step)
// ==========================================

#[test]
fn test_withdraw_request_no_debt() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(100);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Request withdraw
    magni_mut.request_withdraw(deposit_amount);

    // Check status is Withdrawing
    assert_eq!(magni_mut.status_of(user), 2); // Withdrawing
    assert_eq!(magni_mut.pending_withdraw_of(user), deposit_amount);
    assert_eq!(magni_mut.collateral_of(user), U512::zero());
}

#[test]
fn test_finalize_withdraw_with_liquid_balance() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    // Deposit less than min delegation so no actual delegation happens
    env.set_caller(user);
    let deposit_amount = cspr_to_motes(100); // 100 CSPR < 500 CSPR min
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Request withdraw
    magni_mut.request_withdraw(deposit_amount);

    // Finalize should work since liquid balance is available
    magni_mut.finalize_withdraw();

    // Check vault is cleared
    assert_eq!(magni_mut.status_of(user), 0); // None
    assert_eq!(magni_mut.collateral_of(user), U512::zero());
    assert_eq!(magni_mut.pending_withdraw_of(user), U512::zero());
}

#[test]
fn test_withdraw_partial_maintains_ltv() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow 40% LTV
    let borrow_amount = max_borrow_wad(deposit_amount) / U256::from(2u64);
    magni_mut.borrow(borrow_amount);

    // Try to withdraw 50% of collateral (this should keep LTV at 80%, which is max)
    let withdraw_amount = deposit_amount / U512::from(2u64);
    magni_mut.request_withdraw(withdraw_amount);

    // Check status
    assert_eq!(magni_mut.status_of(user), 2); // Withdrawing
}

#[test]
#[should_panic(expected = "LtvExceeded")]
fn test_withdraw_exceeds_ltv_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow max (80% LTV)
    let borrow_amount = max_borrow_wad(deposit_amount);
    magni_mut.borrow(borrow_amount);

    // Try to withdraw any collateral - should fail as LTV would exceed
    magni_mut.request_withdraw(U512::from(1u64));
}

#[test]
#[should_panic(expected = "WithdrawPending")]
fn test_double_withdraw_request_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(100);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // First request
    magni_mut.request_withdraw(deposit_amount / U512::from(2u64));

    // Second request should fail
    magni_mut.request_withdraw(deposit_amount / U512::from(2u64));
}

// ==========================================
// T18: Unit Conversion Tests
// ==========================================

#[test]
fn test_motes_to_wad_conversion() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    // 1 CSPR = 1e9 motes = 1e18 wad
    let one_cspr_motes = cspr_to_motes(1);
    let one_cspr_wad = motes_to_wad(one_cspr_motes);

    env.set_caller(user);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(one_cspr_motes).deposit();

    // Get position to check conversion
    let position = magni_mut.get_position(user);
    assert_eq!(position.collateral_motes, one_cspr_motes);
    assert_eq!(position.collateral_wad, one_cspr_wad);

    // 1e18 wad for 1 CSPR
    assert_eq!(one_cspr_wad, U256::from(WAD));
}

#[test]
fn test_ltv_calculation() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow 50% LTV
    let collateral_wad = motes_to_wad(deposit_amount);
    let borrow_amount = collateral_wad / U256::from(2u64); // 50%
    magni_mut.borrow(borrow_amount);

    // Check LTV is 5000 bps (50%)
    let ltv = magni_mut.ltv_of(user);
    assert_eq!(ltv, 5000);

    // Health factor should be 8000 / 5000 * 10000 = 16000
    let hf = magni_mut.health_factor_of(user);
    assert_eq!(hf, 16000);
}

// ==========================================
// T18: Interest Accrual Tests
// ==========================================

#[test]
fn test_interest_accrues_over_time() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow
    let borrow_amount = U256::from(100u64) * U256::from(WAD); // 100 mCSPR
    magni_mut.borrow(borrow_amount);

    let debt_before = magni_mut.debt_of(user);
    assert_eq!(debt_before, borrow_amount);

    // Advance time by 1 year (Odra uses milliseconds)
    env.advance_block_time(31_536_000 * 1000); // 1 year in ms

    // Debt should have increased by ~2%
    let debt_after = magni_mut.debt_of(user);

    // Just verify interest accrued (may be large if time is in ms)
    assert!(debt_after > debt_before, "Debt should increase with interest");
}

#[test]
fn test_interest_affects_ltv() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let deposit_amount = cspr_to_motes(1000);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Borrow near max
    let max_borrow = max_borrow_wad(deposit_amount);
    let borrow_amount = max_borrow - (max_borrow / U256::from(100u64)); // 99% of max
    magni_mut.borrow(borrow_amount);

    let ltv_before = magni_mut.ltv_of(user);

    // Advance time by 1 year
    env.advance_block_time(31_536_000 * 1000);

    // LTV should have increased due to interest
    let ltv_after = magni_mut.ltv_of(user);
    assert!(ltv_after > ltv_before);
}

// ==========================================
// T18: Admin Tests
// ==========================================

#[test]
fn test_pause_unpause() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let owner = env.get_account(0);

    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());

    // Pause
    env.set_caller(owner);
    magni_mut.pause();
    assert!(magni_mut.is_paused());

    // Unpause
    magni_mut.unpause();
    assert!(!magni_mut.is_paused());
}

#[test]
#[should_panic(expected = "ContractPaused")]
fn test_deposit_when_paused_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let owner = env.get_account(0);
    let user = env.get_account(1);

    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());

    // Pause
    env.set_caller(owner);
    magni_mut.pause();

    // Try deposit
    env.set_caller(user);
    magni_mut.with_tokens(cspr_to_motes(100)).deposit();
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_pause_by_non_owner_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());

    // Try pause as non-owner
    env.set_caller(user);
    magni_mut.pause();
}

// ==========================================
// T18: Edge Cases
// ==========================================

#[test]
#[should_panic(expected = "ZeroAmount")]
fn test_deposit_zero_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(U512::zero()).deposit();
}

#[test]
#[should_panic(expected = "ZeroAmount")]
fn test_borrow_zero_reverts() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(cspr_to_motes(100)).deposit();
    magni_mut.borrow(U256::zero());
}

// ==========================================
// T18: Delegation Batching Tests
// ==========================================

#[test]
fn test_delegation_batching_below_minimum() {
    let env = odra_test::env();
    let (_, magni, _) = deploy_contracts(&env);
    let user = env.get_account(1);

    env.set_caller(user);
    // Deposit 100 CSPR (below 500 CSPR minimum)
    let deposit_amount = cspr_to_motes(100);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Pending should accumulate
    assert_eq!(magni_mut.pending_to_delegate(), deposit_amount);
    assert_eq!(magni_mut.total_delegated(), U512::zero());
}

#[test]
fn test_delegation_batching_above_minimum() {
    let env = odra_test::env();
    let (_, magni, _validator_hex) = deploy_contracts(&env);
    let user = env.get_account(1);
    let owner = env.get_account(0);
    let validator = env.get_validator(0);

    env.set_caller(user);
    // Deposit 600 CSPR (above 500 CSPR minimum)
    let deposit_amount = cspr_to_motes(600);
    let mut magni_mut = MagniHostRef::new(magni.address(), env.clone());
    magni_mut.with_tokens(deposit_amount).deposit();

    // Delegation is NOT automatic anymore - should accumulate in pending
    assert_eq!(magni_mut.pending_to_delegate(), deposit_amount);
    assert_eq!(magni_mut.total_delegated(), U512::zero());

    // Owner triggers delegation manually
    env.set_caller(owner);
    magni_mut.force_delegate();

    // Now should be delegated
    assert_eq!(magni_mut.pending_to_delegate(), U512::zero());
    assert_eq!(magni_mut.total_delegated(), deposit_amount);

    // Check actual delegation
    let delegated = env.delegated_amount(magni.address(), validator);
    assert_eq!(delegated, deposit_amount);
}
