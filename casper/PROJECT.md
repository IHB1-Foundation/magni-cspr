# Magni x Casper — Hackathon Prototype (Odra + Styks Oracle)

## Goal
Build a leverage-staking prototype that runs on Casper Testnet.
- Deliverables: a working Casper Testnet prototype + a public GitHub repo + a demo video

## Minimal Hackathon Design
- Collateral asset: tCSPR (CEP-18 test token) treated as the “staking asset” (simplified)
- Synthetic asset: mCSPR (CEP-18) — only the Magni contract can mint/burn
- Leverage loop:
  1) Deposit tCSPR (= stake & collateralize)
  2) Mint mCSPR (= borrow)
  3) Swap mCSPR -> tCSPR (PoC simplified to a 1:1 swap)
  4) Re-deposit
  5) Reach target leverage (LTV=80% -> max 5x)

## Oracle: Styks (Odra)
- Styks is an Odra-based oracle deployed on Casper Testnet.
- The Magni contract reads `StyksPriceFeed.get_twap_price(feed_id)` via an external contract call.
- Default feed_id: CSPRUSD (injected via env)

## Parameters (PoC)
- LTV = 80% (max 5x)
- Minting fee = 1%
- Fixed interest = 2% APR (PoC: simple accumulation)
- Liquidation fee = 7.5% (optional)

## Must Show in Demo
- Deploy: tCSPR / mCSPR / Magni
- Oracle: read Styks TWAP price (print to logs)
- Flash Open: open a 5x position
- View: show collateral / debt / LTV / accrued interest + oracle price
- Close: repay + withdraw

## DoD
- `cargo odra test` passes
- On Casper Testnet:
  - deployment succeeds
  - Styks price read succeeds (if missing, handle `None` gracefully)
  - 5x open/view/close succeeds
