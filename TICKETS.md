# Tickets — Casper-only Monorepo Refactor

규칙
- 이 파일의 티켓은 **레포 전체(루트 포함)** 를 수정하는 작업이다. (즉, `casper/TICKETS.md`의 “/casper 밖 수정 금지” 규칙과 범위가 다름)
- 삭제/이동이 많으므로 작업 전 새 브랜치 생성 권장.

---

## R1. Refactor to Casper-only monorepo (remove Solidity/EVM stack)
목표
- 이 레포를 **Casper만 지원하는 monorepo** 로 정리한다.
- 기존 Solidity/EVM 관련 패키지(contracts/typechain/deployment/subgraph/evm-frontend 등)는 제거한다.
- 결과적으로 남는 구성은 최소 2개:
  - Casper 컨트랙트: `casper/magni_casper` (Odra/Rust)
  - Casper 프론트: (T7에서 추가한) `casper/frontend` (Casper Wallet only, casper-test only)

Pre-req
- `casper/TICKETS.md`의 **T7, T8, T9** 구현이 끝나 있어야 한다.

To Do
- 남길 것(최종 구조 가이드)
  - `casper/`
    - `casper/magni_casper` (Odra/Rust 컨트랙트)
    - `casper/frontend` (Casper Wallet only, casper-test only)
    - `casper/scripts`, `casper/README.md`, `casper/TICKETS.md` 등 Casper 관련 파일
  - 루트 최소 파일
    - `README.md` (Casper-only로 재작성)
    - `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (Casper 프론트 실행/빌드용)
    - `.gitignore` (Rust/Node 산출물 ignore 포함)
- 삭제 대상(확정, `git rm` 권장)
  - EVM monorepo 디렉토리 전체:
    - `packages/`
    - `subgraph/`
    - `docs/`
    - `docs-old/`
    - `ref/`
    - `scripts/`
    - `config/`
  - EVM/Solidity 패키지 전체:
    - `packages/contracts/`
    - `packages/typechain/`
    - `packages/deployment/`
    - `packages/price-utils/`
    - `packages/common/`
    - `packages/frontend/`
  - VS Code workspace(현 상태는 Solidity/EVM 전용):
    - `magni-monorepo.code-workspace`
  - Root JS tooling(기존 monorepo 공용 설정):
    - `eslint.config.mjs`
    - `config/eslint/`
    - `config/prettier/`
    - `config/typescript/`
- 디렉토리 구조 정리(원칙: Casper 관련만 남긴다)
  - `casper/` 하위는 유지하되, 프론트/컨트랙트/스크립트/문서를 “Casper만” 기준으로 재배치
  - 루트 `README.md`를 Casper-only 기준으로 재작성하고, EVM 관련 설명/배지/링크 제거
  - 루트 `AGENTS.md`를 Casper-only 기준으로 업데이트(기존 `packages/*` 가이드 제거)
- pnpm workspace/스크립트 재구성
  - `pnpm-workspace.yaml`를 Casper-only로 변경(예: `casper/frontend`만 포함)
  - 루트 `package.json`을 Casper-only로 정리:
    - `--recursive` 기반 스크립트 제거
    - 예시(방향): `frontend:dev`, `frontend:build`, `frontend:lint`, `contracts:test`(= `cargo odra test`), `contracts:build`(= `cargo odra build`)
  - `pnpm-lock.yaml`를 정리(삭제된 패키지 반영)
- IDE/품질 설정 정리
  - JS lint/format은 `casper/frontend` 내부로 국소화(프론트 전용 eslint/prettier/tsconfig)
  - `.gitignore`에 Rust/Odra 산출물 추가:
    - `casper/magni_casper/target/`
    - `casper/magni_casper/wasm/`
  - (중요) Rust(Odra) 빌드/테스트에는 영향 없도록 유지

검증(필수)
- Node 쪽
  - `pnpm install`
  - `pnpm --dir casper/frontend build`
- Rust 쪽
  - `(casper/magni_casper) cargo odra test`
  - `(casper/magni_casper) cargo odra build`

DoD
- 레포 내에 Solidity/Hardhat/Typechain/Subgraph 기반 코드가 남아있지 않음
- Casper-only 문서/스크립트로 “한 번에” 재현 가능(프론트 실행 + 컨트랙트 테스트/빌드)
- 커밋: `chore(repo): refactor to casper-only monorepo`
