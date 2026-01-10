# Tickets — Magni x Casper Hackathon Prototype (Monorepo-safe)

## Rules
- Process tickets in order.
- At the end of each ticket:
  1) Run `cargo odra test` in `casper/magni_casper`
  2) Run `cargo odra build` once as well
  3) Commit
- Do not modify anything outside `/casper`.

---

## T0. Scaffold (create Odra workspace)

### Goal
- Create an Odra workspace at `/casper/magni_casper`
- Add `/casper/scripts` and env samples

### To Do
- Create `casper/magni_casper` as a cargo-odra based workspace
- Create `casper/README.md`, `casper/.env.example`, `casper/scripts/*.sh`

### DoD
- `(casper/magni_casper) cargo odra build` succeeds
- Commit: "casper: scaffold odra workspace"

---

## T1. Tokens (CEP-18) — tCSPR + mCSPR

### Goal
- tCSPR: a test token (CEP-18) with faucet mint
- mCSPR: a token (CEP-18) that only Magni can mint/burn

### To Do
- Implement CEP-18 in `tokens.rs`
- Add `faucet_mint(to, amount)` to tCSPR
- Add `set_minter(minter)` for mCSPR, or set the minter during init

### DoD
- Unit tests verify: transfer/approve/transfer_from/faucet_mint
- Commit: "casper: add cep-18 tokens (tCSPR, mCSPR)"

---

## T2. Styks external ABI (Odra external_contract)

### Goal
- Define an external contract interface so `StyksPriceFeed` can be called

### To Do
- Create `contracts/styks_external.rs`
- Define a trait via Odra `#[odra::external_contract]`:
  - `get_twap_price(id: String) -> Option<u64>`

### DoD
- Builds successfully + minimal unit tests (mock/stub allowed)
- Commit: "casper: add styks external contract interface"

---

## T3. Magni core + Styks read

### Goal
- Implement core leverage-staking flows, and include Styks TWAP price in views

### Core math
- LTV = 80%
- Max Leverage = 1/(1-LTV) = 5x
- target_leverage L (1..=5)
  - collateral_total = deposit * L
  - debt = deposit * (L - 1)

### To Do
- Implement `contracts/magni.rs`
  - `init(tCSPR, mCSPR, styks_price_feed_package_hash, feed_id)`
  - `open_position_flash(deposit_amount, target_leverage<=5)`
  - `get_position(user) => collateral, debt, ltv, accrued_interest, oracle_price_option, oracle_ts(optional)`
  - `close_position() => repay + withdraw`
- Styks integration:
  - In `get_position`, call `styks.get_twap_price(feed_id)`
  - If `None`, avoid breaking the demo (e.g. `price_available=false`)

### DoD
- Unit test: L=5 open/view/close succeeds
- Commit: "casper: integrate styks oracle into magni core"

---

## T4. (Optional) Liquidation + rails

### Goal
- Simple liquidation when LTV exceeds max + minimal caps/pause rails

### DoD
- 2 tests (allowed / disallowed)
- Commit: "casper: add liquidation and safety rails"

---

## T5. Testnet deploy + demo binary (Odra livenet)

### Goal
- Deploy to Casper Testnet + Styks read + run a one-shot 5x demo

### To Do
- `src/bin/magni_livenet.rs`
  - deploy: tCSPR -> mCSPR -> Magni
  - set: mCSPR minter=Magni
  - sanity: call `styks.get_twap_price(feed_id)` and print logs
  - demo:
    - faucet mint tCSPR -> approve -> open 5x -> view -> close
  - logs: print contract addresses/results to stdout

### DoD
- Builds successfully
- Runnable via `bash casper/scripts/livenet_deploy_and_demo.sh` (only env setup required)
- Commit: "casper: add livenet deploy+styks+demo"

---

## T6. Scripts + Docs

### Goal
- Complete reproducible setup/build/test/deploy scripts and README instructions

### DoD
- Reproducible by following README
- Commit: "casper: add scripts and docs"

---

## T7. Casper Frontend (Testnet-only + Casper Wallet + delegate-stake CTA)

### Goal
- Add a minimal frontend targeting Casper Testnet only
- Support only Casper Wallet (browser extension)
- For staking guidance: instruct users to delegate to the “top validator” via `https://cspr.live/delegate-stake`

### To Do
- Scaffold a Vite+React app under `/casper/frontend` (or `/casper/magni_casper_frontend`)
  - Network/chain: fixed to Casper Testnet (remove multi-network/multi-chain features)
  - Wallet: Casper Wallet provider only (no other connectors)
- UI (minimum)
  - Connect / Disconnect
  - Show connected account (public key) + copy button
  - “Delegate stake” section:
    - Show default validator public key (copy button)
    - Button to open `cspr.live/delegate-stake` (new tab)
    - Short guidance text: enter amount on cspr.live, then sign/submit via Casper Wallet
- Config (env vars)
  - `VITE_CASPER_CHAIN_NAME=casper-test`
  - `VITE_CASPER_NODE_URL` (for future expansion, e.g. putDeploy)
  - `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY`
    - Default (as of 2026-01-10, top #1 from Casper Testnet `state_get_auction_info`):
      - `012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80`
- Docs
  - Add frontend run instructions and the delegate-stake flow to `casper/README.md`

### DoD
- `pnpm --dir casper/frontend install`
- `pnpm --dir casper/frontend dev` runs locally
- Casper Wallet connect/disconnect works (shows address)
- Can navigate to `https://cspr.live/delegate-stake` and copy the validator key
- Commit: "casper: add casper testnet frontend (casper wallet + delegate-stake)"

---

## T8. Staking strategy config in contract (default validator) + deploy wiring

### Goal
- Persist “top validator #1” as the default strategy and wire validator info into contract/deploy
- (Important) For now, delegation/undelegation transactions are performed via cspr.live; the contract initially only exposes strategy metadata

### To Do
- `casper/magni_casper/src/magni.rs`
  - Add `validator_public_key: Var<String>`
  - Extend `init(..., validator_public_key: String)` and add getter `validator_public_key()`
  - (Optional) Add `events::ValidatorSet` event
- `casper/magni_casper/src/bin/magni_livenet.rs`
  - Read default validator key from env:
    - `DEFAULT_VALIDATOR_PUBLIC_KEY`
      - Default (as of 2026-01-10, top #1 from Casper Testnet `state_get_auction_info`):
        - `012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80`
      - If missing, fall back to empty string/placeholder
  - Pass it into Magni init args during deploy + print in logs
- `casper/README.md` / `.env.example`
  - Add `DEFAULT_VALIDATOR_PUBLIC_KEY`
  - Instruct using the same validator key as the frontend (T7)

### Notes / Follow-ups (out of ticket scope; split into follow-up tickets if needed)
- If the goal is “the contract delegates directly”, first verify whether the Casper auction system contract can be called for delegate/undelegate, and account for unbonding UX (close may not be immediate), etc.

### DoD
- `(casper/magni_casper) cargo odra test` / `cargo odra build` pass
- Livenet deploy logs include the validator key, and it is queryable via getter
- Commit: "casper: wire default validator into magni contract"

---

## T9. Casper dApp v1 (port key EVM frontend features to Casper + wire to Odra contracts)

### Goal
- Port the “core user flow” from `packages/frontend` (EVM wagmi/viem) into a Casper-only app (`casper/frontend`).
- Keep Casper Testnet only + Casper Wallet only.
- The frontend must be able to submit transactions / query state matching current entrypoints in `casper/magni_casper`.

### Scope (porting baseline)
- Implement a simplified Casper version of the EVM frontend concepts:
  - Faucet: mint test token (EVM: faucet page) → (Casper) `tCSPR.faucet_mint`
  - Leverage/Open: open a position (EVM: leverage/deposit/borrow tabs) → (Casper) `tCSPR.approve` + `Magni.open_position`
  - Portfolio/View: view balances/position (EVM: portfolio/strategy detail) → (Casper) `balance_of`, `view_*`, `health_factor`, `get_price`
  - Close/Repay: close position (EVM: repay+withdraw) → (Casper) `Magni.close_position`
- Exclude Swap/Uniswap or other EVM DEX-dependent features (remove pages or show “Not supported on Casper”).

### To Do (Frontend)
- Single-flow UI (minimal routing)
  - On `/` (or a single route), show sections top-to-bottom:
    1) Wallet (connect/disconnect + public key)
    2) Contracts (configured hashes + network info)
    3) Delegate stake (validator key + `cspr.live/delegate-stake` CTA)
    4) Faucet (tCSPR mint)
    5) Open Position (approve + open_position)
    6) Position / Portfolio (balances + position view + close)
- Casper client / wallet connection layer
  - Casper Wallet provider only (connect/disconnect, get active public key)
  - Fixed `VITE_CASPER_CHAIN_NAME=casper-test`, `VITE_CASPER_NODE_URL`
  - Common deploy flow:
    - Build stored-contract call deploy via `casper-js-sdk` (or equivalent)
    - Sign via Casper Wallet
    - Submit via node RPC + poll deploy hash; reflect success/failure in UI
- Contract addresses/hashes config
  - From `.env` (or `src/config/*.ts`):
    - `VITE_TCSPR_CONTRACT_HASH`
    - `VITE_MCSPR_CONTRACT_HASH`
    - `VITE_MAGNI_CONTRACT_HASH`
  - UX when addresses are missing: show guidance + disable actions
- Features (minimum)
  - Delegate stake section:
    - Show default validator key + copy button
    - Button to open `https://cspr.live/delegate-stake` (new tab)
    - Validator key priority:
      1) (If T8 is implemented) `Magni.validator_public_key()` (non-empty has highest priority)
      2) `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY`
    - Short guidance text: enter amount on cspr.live, then sign/submit via Casper Wallet
  - Faucet section:
    - amount input (18 decimals), execute `tCSPR.faucet_mint(to=connected_account, amount)`
    - refresh via `tCSPR.balance_of`
  - Open Position section:
    - show `tCSPR.balance_of` + deposit input
    - leverage selector: 1..=5
    - approval check: `tCSPR.allowance(owner=user, spender=Magni)` + approve tx
    - open tx: `Magni.open_position(collateral_amount, leverage)`
    - after open, refresh:
      - `Magni.view_collateral(user)`, `Magni.view_debt(user)`, `Magni.view_leverage(user)`
      - `Magni.health_factor(user)`, `Magni.get_price()`
  - Position / Portfolio section:
    - show `tCSPR.balance_of(user)`, `mCSPR.balance_of(user)`
    - position summary (if present): collateral/debt/leverage/health factor/price
    - Close button: `Magni.close_position()`
    - (Important UX) warning: “If you transfer mCSPR out, close may fail (contract must burn).”
- Common UX
  - Port/replicate transaction pending/success/error UI from the old frontend for Casper tx flow
  - Add input parsing/format utils for 18 decimals

### To Do (Contracts / ABI friendliness)
- Add view helper(s) so the frontend can render with 1–2 calls (recommended)
  - Provide `get_position(user)` returning `(collateral, debt, leverage, health_factor, price)`
  - (If T8 is done) expose `validator_public_key()` in portfolio/strategy UI
- If helpers are added, also print/verify in livenet demo (`magni_livenet`)

### DoD
- `pnpm --dir casper/frontend install`
- `pnpm --dir casper/frontend dev` runs locally
- With Casper Wallet connected, the following works end-to-end on Casper Testnet:
  1) receive tCSPR via `faucet_mint`
  2) approve and successfully `open_position(1..=5)`
  3) position/balances render correctly
  4) `close_position` succeeds (verify balances/position reset)
- Commit: "casper: add casper dapp v1 (faucet/open/view/close)"

---

## T10. Testnet all-in-one deploy script (deploy + FE wiring + CONTRACTS.md)

### Goal
- Create an all-in-one deploy script that deploys contracts (tCSPR/mCSPR/Magni) to Casper Testnet and:
  1) automatically wires the resulting addresses/hashes into `casper/frontend`, and
  2) appends a deployment record to `casper/CONTRACTS.md`,
  in a single run.

### To Do
- Create `casper/CONTRACTS.md`
  - Example format:
    - Network: Casper Testnet (`casper-test`)
    - Date (UTC)
    - Node RPC URL
    - tCSPR contract hash
    - mCSPR contract hash
    - Magni contract hash
    - (Optional) Styks: package hash + feed id
    - (If T8 is done) default validator public key
- Improve `casper/magni_casper/src/bin/magni_livenet.rs`
  - Print deploy results in a machine-readable way (recommended: a single JSON line at the end)
    - e.g. `MAGNI_DEPLOY_JSON={...}`
  - JSON must include at least:
    - `network` / `chain_name`
    - `tcspr_contract_hash`, `mcspr_contract_hash`, `magni_contract_hash`
    - (If possible) include package hash / contract package hash as well
  - Prefer identifiers usable by the frontend (usually contract hash)
- Add script: `casper/scripts/testnet_deploy_and_wire_frontend.sh`
  - Input: `casper/.env` (or env vars)
    - `ODRA_CASPER_LIVENET_SECRET_KEY_PATH`
    - `ODRA_CASPER_LIVENET_NODE_ADDRESS`
    - `ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test`
    - (Optional) `STYKS_PRICE_FEED_PACKAGE_HASH`, `STYKS_PRICE_FEED_ID`
    - (Optional) `DEFAULT_VALIDATOR_PUBLIC_KEY`
  - Behavior:
    1) Run `(casper/magni_casper) cargo run --bin magni_livenet --features=livenet`
    2) Parse deploy JSON from stdout
    3) Auto-write/update `casper/frontend/.env.local` (or `casper/frontend/.env`) with:
       - `VITE_CASPER_CHAIN_NAME=casper-test`
       - `VITE_CASPER_NODE_URL=<node rpc>`
       - `VITE_TCSPR_CONTRACT_HASH=<tcspr_contract_hash>`
       - `VITE_MCSPR_CONTRACT_HASH=<mcspr_contract_hash>`
       - `VITE_MAGNI_CONTRACT_HASH=<magni_contract_hash>`
       - `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY=<DEFAULT_VALIDATOR_PUBLIC_KEY>` (if available)
    3.1) Auto-generate/update `casper/frontend/src/config/contracts.generated.ts` (keep in sync)
       - exports: `chainName`, `nodeUrl`, `tcsprContractHash`, `mcsprContractHash`, `magniContractHash`, `defaultValidatorPublicKey`
       - frontend priority should be consistent: `.env (VITE_*)` → `contracts.generated.ts` fallback (or the reverse, but pick one)
    4) Append to `casper/CONTRACTS.md` (or update the latest section)
    5) After the script, a human should be able to run `pnpm --dir casper/frontend dev` without additional copy/paste
    6) Ensure `(smoke) pnpm --dir casper/frontend build` does not break
  - Failure handling:
    - If required env vars are missing, exit with a clear error message
    - If JSON parsing fails, explain the cause and where to find logs

### DoD
- `(casper/magni_casper) cargo odra test` succeeds
- `(casper/magni_casper) cargo odra build` succeeds
- After `bash casper/scripts/testnet_deploy_and_wire_frontend.sh`:
  - `casper/frontend/.env.local` is created/updated
  - `casper/CONTRACTS.md` has the appended addresses
- Smoke checks succeed:
  - `pnpm --dir casper/frontend install`
  - `pnpm --dir casper/frontend build`
  - (Manual) Run `pnpm --dir casper/frontend dev` and verify the UI loads contract hashes and tx buttons are enabled
- Commit: "casper: add testnet all-in-one deploy+wire script"

---

## T11. [Research Spike] “Can a contract delegate CSPR directly?” (Casper 2.0 / Odra 2.4)

### Background
- Current PoC treats `tCSPR (CEP-18)` as the “staking asset” and mints `mCSPR`, which is separate from **native Casper staking (delegation)**.
- Proposed pivot: instead of “issuing an LST token”, build a vault where depositing stake (= CSPR deposit) causes the contract to delegate to a validator.
- Historically, Casper delegation was account (main purse) based, so a WASM contract could not delegate/undelegate directly (verify whether this is still true as of 2026-01-10).

### Research checklist (includes required links/keywords)
- Casper docs (delegation / unbonding / min delegation 500 CSPR / 7 eras):
  - https://docs.casper.network/users/delegating/
- Discussion about “contracts couldn’t stake” (to understand blockers):
  - https://medium.com/casper-association-r-d/casper-staking-from-smart-contract-2143df7752fc
- Odra 2.4 docs show `ContractContext::delegate / undelegate / delegated_amount` APIs:
  - https://docs.odra.dev/advanced-features/staking

### Goal
- **Most important:** confirm whether native staking calls from a stored contract (WASM context) are possible/impossible on an actual network (`casper-test`).
- If possible: document the exact implementation path (args required, key/purse types, call path).
- If impossible: decide an alternative architecture (user delegates in frontend, or off-chain operator + oracle/reporting, etc.) and branch follow-up tickets accordingly.

### To Do
1) Add a minimal PoC contract (recommended to keep separate from existing Magni)
   - `casper/magni_casper/src/staking_poc.rs` (or `src/contracts/staking_poc.rs`)
   - entrypoints:
     - `#[odra(payable)] stake(validator_public_key: String)`:
       - `let amount = self.env().attached_value();` (motes, U512)
       - try `self.env().delegate(validator_public_key, amount)`
     - `#[odra(payable)] request_unstake(validator_public_key: String, amount: U512)`:
       - try `self.env().undelegate(validator_public_key, amount)`
     - `delegated_amount(validator_public_key: String) -> U512`:
       - `self.env().delegated_amount(validator_public_key)`
2) In odra-test, verify whether delegate/undelegate calls compile/run
   - Warning: odra-test might simulate this “as if it works”, so **livenet verification is required**.
3) On casper-test (livenet), verify whether staking actually happens
   - Recommended: add `casper/magni_casper/src/bin/staking_poc_livenet.rs`
   - flow:
     - deploy staking_poc
     - (caller has CSPR) call `stake` with attached CSPR
     - via RPC, check `state_get_auction_info`:
       - does the delegator show up as the “contract/package/entity”, or does the tx revert?
4) Document results
   - Create `casper/RESEARCH/delegation-from-contract.md`
   - Include: possible/impossible, error details (revert msg/enum if available), network version, odra version, reproduction commands

### DoD
- “Can a stored contract delegate directly on Casper testnet?” is confirmed in a reproducible way.
- The result doc includes:
  - validator key / amount (motes) / deploy hash examples
  - how to snapshot auction info on success, or root cause on failure (e.g. no main purse, system contract call restrictions, etc.)
  - a decision on which follow-up track to take (T12/T13)
- Commit: "casper: research delegation-from-contract feasibility"

---

## T12. [Main Track] Decide “vault staking” architecture + update Magni design (including leverage)

### Assumptions
- Choose a track based on T11 results.
- The goal is not “issuing an LST token”, but managing user claims via **internal share accounting (non-token and/or SBT)**.

### Key decisions (must be written at ticket start)
- (A) Contract can delegate directly: handle deposit→delegate and withdraw→undelegate fully on-chain.
- (B) Contract cannot delegate directly: choose one
  - (B1) Non-custodial / user-driven: frontend has users directly delegate/undelegate via auction contract deploys; Magni manages only “leverage/debt token” (cannot enforce stake lock as collateral on-chain).
  - (B2) Custodial / operator: contract handles CSPR deposit/withdraw/accounting, but an off-chain operator account performs actual delegate/undelegate (optionally with oracle/reporting). Introduces trust assumptions.

### Goal (common)
- Continue supporting “leverage staking” via the current model (= mint/burn `mCSPR`), while:
  - normalizing the collateral/staking asset unit to **native CSPR (motes)** (ideally removing dependency on tCSPR)
  - reflecting **unbonding delay (e.g. 7 eras)** in UX/state-machine (close may not be immediate)

### To Do (recommended design draft — must be finalized before implementation)
1) Units/decimals
   - Casper staking uses motes (U512, 1 CSPR = 1e9 motes).
   - Current contracts use 18 decimals (U256). Choose one:
     - (Recommended) normalize internal amounts to motes (U512), and only convert for frontend display
     - (Alternative) keep 18 decimals internally but convert to motes on staking calls (high risk of mistakes)
2) Redefine Magni position model (resolve math mismatch between code/tickets)
   - Consistently define “LTV=80% implies 5x leverage”:
     - deposit (user equity) = D
     - target leverage = L (1..=5)
     - total_staked = D * L
     - debt = D * (L - 1)
     - then `debt / total_staked = (L-1)/L`; for L=5 this is 0.8, exactly matching LTV
3) (Track A) example state machine
   - `open_position(leverage)` is `#[odra(payable)]`:
     - attach D motes
     - (if leverage>1) allocate B = D*(L-1) motes as “borrowed” from a vault reserve
     - delegate total_staked = D + B to validator
     - mint `mCSPR` equal to debt (convert units/decimals as decided)
   - `request_close_position()`:
     - undelegate(total_staked)
     - until unbonding completes, `close_position()` reverts or returns “pending”
   - `finalize_close_position()`:
     - after unbonding, when CSPR becomes withdrawable:
       - return debt portion B to reserve
       - return remainder (principal + rewards) to user (define reward policy)
     - burn `mCSPR`
4) Reserve (leverage liquidity)
   - To provide immediate leverage, reserve must be **un-staked liquid CSPR** (if staked, it cannot be lent immediately due to unbonding).
   - Minimal implementation:
     - `#[odra(payable)] provide_reserve()` / `withdraw_reserve(amount)` (can start as owner-only)
     - track `reserve_available`
5) View/API friendliness (frontend/scripts)
   - Provide a single-call `get_position(user)` struct:
     - state (open / closing_pending / closed)
     - equity(D), debt(B), total_staked, validator, timestamps (era info if possible)
     - (Track A) delegated_amount / unbonding status (as far as feasible)

### DoD
- The chosen track (A/B1/B2) and rationale are reflected in `casper/PROJECT.md` or `casper/RESEARCH/...`.
- For the chosen track, the “open → (pending) → close” flow is clearly defined as a state machine with entrypoints.
- Commit: "casper: define vault-staking architecture and update magni design"

---

## T13. (Per-track implementation) End-to-end contract/frontend flow

### Goal
- Based on the chosen track in T12, build a **usable UX**.

### Track A (on-chain delegation) — To Do (summary)
- Contracts
  - Refactor `casper/magni_casper/src/magni.rs` into “native CSPR payable + vault staking”
  - Remove or isolate legacy `tCSPR` collateral logic (demo-only)
  - Unit tests:
    - `open_position(L=1..=5)` works
    - `request_close` → (if era simulation possible) `finalize_close`
    - revert when reserve is insufficient
- Frontend
  - Remove “Delegate stake” CTA (or replace with “contract auto-delegates” guidance)
  - Open Position: attach CSPR input (CSPR unit in UI; convert to motes internally)
  - Close: split UI into a 2-step flow (request/finalize)

### Track B1 (user delegates directly) — To Do (summary)
- In the frontend, implement Delegate/Undelegate as **direct transactions**, not just cspr.live links
  - Inject auction contract hash via env (`VITE_AUCTION_CONTRACT_HASH`)
  - entrypoints:
    - `delegate(delegator, validator, amount)`
    - `undelegate(delegator, validator, amount)`
  - Add guidance about unbonding delay and min amount (500 CSPR) from Casper docs
- Keep existing PoC contracts (tCSPR + mCSPR), but explicitly warn in docs/frontend:
  - “This position does not lock native stake on-chain as collateral.”

### Track B2 (operator) — To Do (summary)
- Contracts
  - Emit events for stake deposit/withdraw requests
  - Configure operator address (owner-only) + emergency withdraw rails
- Off-chain (scripts/service)
  - Watch events → operator delegates/undelegates with its key
  - Report results back to the contract if needed, or document a human-operated procedure as the minimum

### DoD
- End-to-end testnet demo is possible for the selected track:
  - Track A: open (attach CSPR) → verify delegation → close (reflect unbonding)
  - Track B1: run delegate tx in dApp → (separately) run PoC open/close
  - Track B2: deposit event → operator delegate → withdraw event handling
- Commit: "casper: implement end-to-end staking flow (selected track)"

---

# V2 — CSPR Vault (Collateralized Borrowing) + Staking Delegation (Swap loop implemented externally)

## Background
- Current `Magni` (staking-based leverage PoC) is an “open_position(leverage)” leverage-position model.
- V2 redesigns it into a **standard collateralized lending vault** model:
  - Users deposit CSPR (= collateral), and the protocol delegates deposited funds for staking.
  - Users can mint (= borrow) **mCSPR (debt token)** up to **80% LTV** of collateral value.
  - mCSPR debt accrues **2% APR interest**.
  - Users can withdraw collateral (CSPR) as long as the collateral ratio stays safe; users can add collateral / repay any time.
- The core leverage loop “mCSPR → (external SwapPool) → CSPR → re-deposit” is implemented **externally** and is out of contract scope.

## V2 key assumptions (must be locked and written down at ticket start)
- Price (oracle):
  - Assume **1 mCSPR = 1 CSPR (nominal)** and compute LTV 1:1 (no oracle needed).
  - Oracle-based (USD) LTV is out of V2 scope (split into a future ticket).
- Units/decimals:
  - Native CSPR transfer/staking uses motes (U512, 1 CSPR = 1e9 motes).
  - mCSPR remains 18 decimals (U256).
  - Therefore, define **explicit conversion rules** (motes ↔ 18 decimals) in the contract (no “just casting”).
- Withdraw UX:
  - Casper staking has unbonding delay after undelegation, so withdrawals are a **2-step** state machine by default: `request_withdraw` → `finalize_withdraw`.
  - If the contract still has liquid CSPR (e.g. due to batching/gas/min delegation policy), finalize can be immediate.

---

## T14. Lock V2 spec + write a state/interface design doc

### Goal
- Lock the V2 contract interface/state machine/units/interest model **before writing code** (doc should be implementable directly).

### To Do
- Add a V2 spec section to `/casper/PROJECT.md` (or create `casper/RESEARCH/v2-vault-spec.md`):
  - Terminology: collateral/debt/LTV/health factor/unbonding/pending withdraw
  - Units:
    - conversions between `motes` (U512) ↔ `wad` (18 decimals, U256) and rounding rules (never disadvantage users)
  - Interest model:
    - choose between “per-second simple interest” vs “index-based accrual (effectively compounding)”
    - specify on-demand accrual (on user action) + `last_accrual_timestamp` / `index` storage
  - State machine:
    - deposit/add_collateral
    - borrow
    - repay
    - request_withdraw (undelegate)
    - finalize_withdraw (transfer after unbonding)
  - Invariants:
    - `debt_with_interest(user) <= collateral_value(user) * 0.8` (after every state transition)
    - debt never goes negative after repay (prevent underflow)
    - `mCSPR.total_supply` matches total debt (or document explicit differences)
  - Event/error enum draft
  - Explicitly state: “external swap loop is out of scope”

### DoD
- The design doc locks **entrypoint signatures (name/args/units)** so it can be implemented as-is.
- Commit: "docs(casper): define V2 vault spec and invariants"

---

## T15. (V2) Redesign Magni contract: Vault + Borrow/Repay/Withdraw (2-step)

### Goal
- Replace the PoC centered around `open_position(leverage)` with the V2 vault model (or split into a new module).

### To Do (recommended entrypoints — finalize in T14)
- Core (user)
  - `#[odra(payable)] deposit()`:
    - reflect `attached_value` as collateral
    - (Track A) if possible, delegate for staking (min delegation/batching policy in T17)
  - `#[odra(payable)] add_collateral()`:
    - alias for deposit (UX convenience)
  - `borrow(amount_mcspr_wad: U256)`:
    - accrue interest
    - check `debt_after <= collateral * LTV_MAX`
    - mint mCSPR to user
  - `repay(amount_mcspr_wad: U256)`:
    - accrue interest
    - recommended: `mCSPR.transfer_from(user, self, amount)` then `mCSPR.burn(self, amount)`
      - reason: avoids UX foot-guns like “close fails if user transferred mCSPR out”
  - `request_withdraw(amount_motes: U512)`:
    - accrue interest
    - LTV check after collateral decreases (must remain safe)
    - if liquid balance is insufficient, trigger `undelegate` and record pending state
  - `finalize_withdraw()` or `finalize_withdraw(request_id)`:
    - once liquid balance is available after unbonding, transfer CSPR
    - clear pending state
- Admin (owner)
  - `set_validator_public_key(new_key: String)`
  - `pause()` / `unpause()`
  - (Optional) `set_ltv_max_bps(8000)` / `set_interest_rate_bps(200)` (constants are OK initially)
- Views
  - `get_position(user)`:
    - collateral (either motes+wad, or pick one consistently)
    - debt_principal + debt_with_interest
    - LTV / health_factor
    - pending_withdraw info
  - keep debug views like `self_balance()` / `delegated_amount()` as needed

### Notes (implementation decision)
- Decide whether to fully replace the existing leverage PoC or keep it as `MagniLeverage` in a separate module.
  - If V2 is the goal, prefer removing/hiding PoC entrypoints to avoid frontend confusion.

### DoD
- V2 entrypoints can compile/deploy, and the “deposit → borrow → repay → withdraw (2-step)” flow is coherent at the contract level.
- Commit: "feat(contracts): implement V2 CSPR vault (deposit/borrow/repay/withdraw)"

---

## T16. (V2) Implement interest accrual (2% APR) + lock precision/rounding rules

### Goal
- Make mCSPR debt accrue at 2% APR over time, with a clear and transparent “when/how” model.

### To Do
- Implement based on the chosen model:
  - (A) per-user: track `debt_principal`, `last_accrual_ts`, and on action `debt = debt + debt*rate*dt/year`
  - (B) global index: track `debt_index`, `last_accrual_ts`, per-user `scaled_debt` (RAY) approach
- Call `accrue_interest(user)` at the start of all state-changing functions (or an equivalent pattern).
- Rounding:
  - prevent overflow/underflow in interest math
  - document rounding direction (conservatively “protocol-favoring”, but explain UX/accounting implications)

### DoD
- Unit tests confirm debt increases after time passes (within tolerance).
- Commit: "feat(contracts): add 2% APR interest accrual for mCSPR debt"

---

## T17. (V2) Staking delegation policy (min delegation, batching, partial withdraw)

### Goal
- Implement “delegate deposited CSPR for staking” without contradicting the V2 state machine.

### To Do
- Choose a policy that respects Casper min delegation (500 CSPR) and document it:
  - (Recommended) pooled delegation + batching:
    - accumulate deposits in `pending_to_delegate_motes`, and call `delegate` once it reaches >= 500 CSPR
  - On withdraw requests:
    - if liquid balance is enough, allow immediate finalize
    - otherwise call `undelegate` and move to pending-withdraw state
- Since `undelegate` removes from a pooled delegation, tracking per-user pending amount is sufficient.
- Events:
  - `DelegationTriggered(amount)`
  - `UndelegationRequested(amount, user)`

### DoD
- Deposits < 500 CSPR are accepted for accounting, and staking/withdraw behavior follows the documented policy (clear in docs/tests).
- Commit: "feat(contracts): add delegation batching and withdraw unbonding flow"

---

## T18. (V2) Strengthen tests (OdraVM)

### Goal
- Lock V2 invariants/edge cases in tests as a safety net.

### To Do (required test cases)
- Basic flows
  - deposit → borrow (max 80%) succeeds
  - repay (partial/full) succeeds
  - request_withdraw (safe amount) succeeds + finalize_withdraw (after unbonding) succeeds
- Failure cases
  - borrow reverts if it exceeds LTV
  - withdraw reverts if it exceeds LTV
  - repay reverts if allowance/balance is insufficient
- Interest
  - debt increases after time passes
  - repay applies accrued interest before reducing debt (order is guaranteed)
- Units/decimals
  - motes↔wad conversion is consistent, and the 1e9/1e18 unit bug does not regress

### DoD
- V2 tests pass reliably in `(casper/magni_casper) cargo odra test`.
- Commit: "test(contracts): add V2 vault invariants and flows"

---

## T19. (V2) Update livenet demo/deploy scripts

### Goal
- Provide reproducible scripts/binaries to run the V2 flow on Casper testnet.

### To Do
- Update `magni_livenet` (or add a new `vault_livenet`) flow:
  - deploy mCSPR + V2 Magni
  - `set_minter(V2 Magni)`
  - deposit (attach CSPR) → borrow → repay → request_withdraw
  - if unbonding wait is hard to automate, split “wait then finalize” into a separate mode
- Update output formats and address injection in `casper/DEPLOY.md` and `casper/CONTRACTS.md`

### DoD
- At least one end-to-end log exists on testnet, and reproduction commands are documented.
- Commit: "chore(casper): update livenet demo for V2 vault flow"

---

## T20. (V2) Frontend UX rework (deposit/borrow/repay/withdraw)

### Goal
- Ensure the frontend no longer calls PoC entrypoints like `open_position(leverage)`/`close_position()`, and instead provides a V2 vault UX.

### To Do
- Screens/actions
  - Deposit (attach CSPR), Borrow (mCSPR), Repay (mCSPR), Withdraw (2-step request/finalize)
  - Position card: collateral, debt (with interest), LTV, health factor, pending withdraw state
- Token UX
  - Repay uses `approve` → `repay(amount)` (show allowance)
- Env vars / addresses
  - Update `VITE_*_CONTRACT_HASH` etc for latest entrypoints/contract names

### DoD
- `pnpm --dir casper/frontend build` succeeds
- On testnet, at least one real tx is executed up to “deposit/borrow” (withdraw finalize can be split depending on unbonding timing).
- Commit: "feat(frontend): add V2 vault UX (deposit/borrow/repay/withdraw)"
