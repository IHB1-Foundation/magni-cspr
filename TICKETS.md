# Tickets — Casper-only Monorepo Refactor

## Rules
- Tickets in this file may modify the **entire repository (including the root)**. (This is different from `casper/TICKETS.md`, which has a “do not modify outside /casper” rule and scope.)
- There will be many deletes/moves, so it’s recommended to create a new branch before starting.

---

## R1. Refactor to Casper-only monorepo (remove Solidity/EVM stack)

### Goal
- Refactor this repo into a **Casper-only monorepo**.
- Remove existing Solidity/EVM-related packages (contracts/typechain/deployment/subgraph/evm-frontend, etc.).
- The remaining structure should include at least:
  - Casper contracts: `casper/magni_casper` (Odra/Rust)
  - Casper frontend: `casper/frontend` (Casper Wallet only, casper-test only)

### Pre-req
- `casper/TICKETS.md` **T7, T8, T9** must be completed.

### To Do
- What to keep (final structure guide)
  - `casper/`
    - `casper/magni_casper` (Odra/Rust contracts)
    - `casper/frontend` (Casper Wallet only, casper-test only)
    - Casper-related files such as `casper/scripts`, `casper/README.md`, `casper/TICKETS.md`
  - Minimal root files
    - `README.md` (rewrite for Casper-only)
    - `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (for running/building the Casper frontend)
    - `.gitignore` (including Rust/Node build outputs)
- Deletions (confirmed; prefer `git rm`)
  - Entire EVM monorepo directories:
    - `packages/`
    - `subgraph/`
    - `docs/`
    - `docs-old/`
    - `ref/`
    - `scripts/`
    - `config/`
  - EVM/Solidity packages:
    - `packages/contracts/`
    - `packages/typechain/`
    - `packages/deployment/`
    - `packages/price-utils/`
    - `packages/common/`
    - `packages/frontend/`
  - VS Code workspace (currently Solidity/EVM-focused):
    - `magni-monorepo.code-workspace`
  - Root JS tooling (legacy monorepo shared config):
    - `eslint.config.mjs`
    - `config/eslint/`
    - `config/prettier/`
    - `config/typescript/`
- Directory structure cleanup (principle: keep Casper-only)
  - Keep `casper/`, but reorganize frontend/contracts/scripts/docs around “Casper only”
  - Rewrite root `README.md` for Casper-only and remove EVM-related descriptions/badges/links
  - Update root `AGENTS.md` for Casper-only (remove legacy `packages/*` guidance)
- pnpm workspace/scripts restructure
  - Change `pnpm-workspace.yaml` to Casper-only (e.g. include only `casper/frontend`)
  - Clean up root `package.json` for Casper-only:
    - remove `--recursive`-based scripts
    - example direction: `frontend:dev`, `frontend:build`, `frontend:lint`, `contracts:test` (= `cargo odra test`), `contracts:build` (= `cargo odra build`)
  - Regenerate `pnpm-lock.yaml` to reflect removed packages
- IDE/quality settings cleanup
  - Localize JS lint/format to `casper/frontend` (frontend-only eslint/prettier/tsconfig)
  - Add Rust/Odra outputs to `.gitignore`:
    - `casper/magni_casper/target/`
    - `casper/magni_casper/wasm/`
  - (Important) Keep Rust (Odra) build/test unaffected

### Verification (required)
- Node
  - `pnpm install`
  - `pnpm --dir casper/frontend build`
- Rust
  - `(casper/magni_casper) cargo odra test`
  - `(casper/magni_casper) cargo odra build`

### DoD
- No Solidity/Hardhat/Typechain/Subgraph-based code remains in the repo
- Casper-only docs/scripts can reproduce everything “in one go” (frontend run + contract test/build)
- Commit: `chore(repo): refactor to casper-only monorepo`
