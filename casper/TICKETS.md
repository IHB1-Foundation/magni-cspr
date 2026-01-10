# Tickets — Magni x Casper Hackathon Prototype (Monorepo-safe)

규칙
- 티켓은 순서대로 처리한다.
- 각 티켓 종료 시:
  1) (casper/magni_casper)에서 cargo odra test 실행
  2) build도 한번 실행 (cargo odra build)
  3) 커밋
- /casper 밖은 절대 수정하지 않는다.

---

## T0. Scaffold (Odra workspace 생성)
목표
- /casper/magni_casper Odra workspace 생성
- /casper/scripts 및 env 샘플 추가

To Do
- casper/magni_casper를 cargo-odra 기반 workspace로 생성
- casper/README.md, casper/.env.example, casper/scripts/*.sh 생성

DoD
- (casper/magni_casper) `cargo odra build` 성공
- 커밋: "casper: scaffold odra workspace"

---

## T1. Tokens (CEP-18) — tCSPR + mCSPR
목표
- tCSPR: faucet mint 가능한 테스트 토큰(CEP-18)
- mCSPR: Magni만 mint/burn 가능한 토큰(CEP-18)

To Do
- tokens.rs에 CEP-18 구현
- tCSPR에 faucet_mint(to, amount)
- mCSPR에 set_minter(minter) 또는 init에서 minter 지정

DoD
- 단위 테스트: transfer/approve/transfer_from/faucet_mint 검증
- 커밋: "casper: add cep-18 tokens (tCSPR, mCSPR)"

---

## T2. Styks external ABI (Odra external_contract)
목표
- StyksPriceFeed를 external contract로 호출 가능하게 정의

To Do
- contracts/styks_external.rs 생성
- Odra `#[odra::external_contract]`로 trait 정의:
  - get_twap_price(id: String) -> Option<u64>

DoD
- 컴파일 성공 + 최소 단위 테스트(모킹/스텁 가능)
- 커밋: "casper: add styks external contract interface"

---

## T3. Magni core + Styks read
목표
- 레버리지 스테이킹 핵심 기능 + Styks TWAP price를 조회에 포함

핵심 수학
- LTV = 80%
- Max Leverage = 1/(1-LTV) = 5x
- target_leverage L (1..=5)
  - collateral_total = deposit * L
  - debt = deposit * (L - 1)

To Do
- contracts/magni.rs 구현
  - init(tCSPR, mCSPR, styks_price_feed_package_hash, feed_id)
  - open_position_flash(deposit_amount, target_leverage<=5)
  - get_position(user) => collateral, debt, ltv, accrued_interest, oracle_price_option, oracle_ts(optional)
  - close_position() => repay + withdraw
- Styks 호출:
  - get_position에서 styks.get_twap_price(feed_id) 호출
  - None이면 demo가 깨지지 않게 `price_available=false` 형태로 처리

DoD
- 단위 테스트: L=5 open/view/close 성공
- 커밋: "casper: integrate styks oracle into magni core"

---

## T4. (옵션) Liquidation + rails
목표
- ltv 초과 시 청산(간단 버전) + caps/pause 최소 레일

DoD
- 테스트 2개(가능/불가)
- 커밋: "casper: add liquidation and safety rails"

---

## T5. Testnet deploy + demo binary (Odra livenet)
목표
- Casper Testnet에 배포 + Styks read + 5x 데모를 원샷 실행

To Do
- src/bin/magni_livenet.rs
  - deploy: tCSPR -> mCSPR -> Magni
  - set: mCSPR minter=Magni
  - sanity: styks.get_twap_price(feed_id) 호출 후 로그 출력
  - demo:
    - faucet mint tCSPR -> approve -> open 5x -> view -> close
  - 로그: 컨트랙트 주소/결과를 stdout에 출력

DoD
- 컴파일 성공
- `bash casper/scripts/livenet_deploy_and_demo.sh`로 실행 가능(환경변수 세팅만 하면 됨)
- 커밋: "casper: add livenet deploy+styks+demo"

---

## T6. Scripts + Docs
목표
- setup/build/test/deploy 스크립트 및 README 재현 절차 완성

DoD
- README 따라 실행하면 재현 가능
- 커밋: "casper: add scripts and docs"

---

## T7. Casper Frontend (Testnet-only + Casper Wallet + delegate-stake CTA)
목표
- Casper Testnet만 대상으로 하는 최소 프론트엔드 추가
- 지갑은 Casper Wallet(브라우저 확장)만 지원
- 스테이킹 전략은 `https://cspr.live/delegate-stake`에서 “가장 위 validator”에 위임(delegate)하는 것으로 안내/유도

To Do
- `/casper/frontend` (또는 `/casper/magni_casper_frontend`)에 Vite+React 앱 스캐폴딩
  - 네트워크/체인: Casper Testnet 고정(다른 네트워크 스위치/멀티체인 기능 제거)
  - 지갑: Casper Wallet provider만 연결(다른 지갑 커넥터 없음)
- 화면(최소)
  - Connect / Disconnect
  - 연결된 account(public key) 표시 + 복사 버튼
  - “Delegate stake” 섹션:
    - 기본 validator public key 표시(복사 버튼)
    - `cspr.live/delegate-stake`로 이동 버튼(새 탭)
    - 간단한 안내 문구: cspr.live에서 amount 입력 후 Casper Wallet로 sign/submit
- 설정(환경변수)
  - `VITE_CASPER_CHAIN_NAME=casper-test`
  - `VITE_CASPER_NODE_URL` (putDeploy 등 추후 확장 대비)
  - `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY`
    - 기본값(2026-01-10 기준, Casper Testnet `state_get_auction_info` 상위 #1):
      - `012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80`
- 문서
  - `casper/README.md`에 프론트 실행 방법과 “delegate-stake” 플로우 추가

DoD
- `pnpm --dir casper/frontend install`
- `pnpm --dir casper/frontend dev`로 로컬 실행 가능
- Casper Wallet 연결/해제 동작 확인(주소 표시까지)
- 버튼을 통해 `https://cspr.live/delegate-stake`로 이동 가능 + validator key 복사 가능
- 커밋: "casper: add casper testnet frontend (casper wallet + delegate-stake)"

---

## T8. Staking strategy config in contract (default validator) + deploy wiring
목표
- “가장 위 validator 1개”를 기본 전략으로 고정할 수 있게 컨트랙트/배포에 validator 정보를 반영
- (중요) 실제 delegate/undelegate 트랜잭션은 우선 cspr.live에서 수행하는 것으로 두고, 컨트랙트는 전략(validator) 메타데이터를 노출하는 수준부터 시작

To Do
- `casper/magni_casper/src/magni.rs`
  - `validator_public_key: Var<String>` 추가
  - `init(..., validator_public_key: String)`로 확장 + getter `validator_public_key()` 추가
  - (선택) `events::ValidatorSet` 이벤트 추가
- `casper/magni_casper/src/bin/magni_livenet.rs`
  - env에서 기본 validator key 읽기:
    - `DEFAULT_VALIDATOR_PUBLIC_KEY`
      - 기본값(2026-01-10 기준, Casper Testnet `state_get_auction_info` 상위 #1):
        - `012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80`
      - (없으면 빈 문자열/placeholder로 fallback)
  - Magni deploy 시 init args에 전달 + 로그 출력
- `casper/README.md` / `.env.example`
  - `DEFAULT_VALIDATOR_PUBLIC_KEY` 항목 추가
  - 프론트(T7)와 동일한 validator key를 쓰도록 안내

Notes / Follow-ups (티켓 범위 밖, 필요 시 후속 티켓으로 분리)
- “컨트랙트가 직접 delegate 한다”를 목표로 하면 Casper auction 시스템 컨트랙트(delegate/undelegate) 호출 가능 여부, unbonding 기간/UX(즉시 close 불가) 등을 먼저 검증해야 함.

DoD
- (casper/magni_casper) `cargo odra test` / `cargo odra build` 통과
- livenet deploy 로그에 validator key가 출력되고 getter로 조회 가능
- 커밋: "casper: wire default validator into magni contract"

---

## T9. Casper dApp v1 (port key EVM frontend features to Casper + wire to Odra contracts)
목표
- 기존 `packages/frontend`(EVM wagmi/viem)에서 “유저가 실제로 하던 핵심 플로우”를 Casper 전용(`casper/frontend`)으로 포팅한다.
- Casper Testnet only + Casper Wallet only 원칙 유지.
- Casper 컨트랙트(`casper/magni_casper`)의 현재 entrypoints에 맞춰 프론트에서 직접 트랜잭션/조회가 가능해야 한다.

범위(포팅 기준)
- EVM 프론트의 개념을 Casper 버전으로 단순화해서 구현:
  - Faucet: 테스트 토큰 민트 (EVM: faucet page) → (Casper) `tCSPR.faucet_mint`
  - Leverage/Open: 포지션 오픈 (EVM: leverage/deposit/borrow 탭 조합) → (Casper) `tCSPR.approve` + `Magni.open_position`
  - Portfolio/View: 포지션/잔액 조회 (EVM: portfolio/strategy detail) → (Casper) `balance_of`, `view_*`, `health_factor`, `get_price`
  - Close/Repay: 포지션 종료 (EVM: repay+withdraw) → (Casper) `Magni.close_position`
- Swap/Uniswap 등 EVM DEX 의존 기능은 범위에서 제외(페이지 제거 또는 “Not supported on Casper” 처리).

To Do (Frontend)
- 단일 플로우 UI로 구성(라우팅 최소화)
  - `/` 한 페이지(또는 1개 route)에서 아래 섹션을 위→아래 순서로 제공:
    1) Wallet (connect/disconnect + public key)
    2) Contracts (contract hash 설정 상태 + 네트워크 정보)
    3) Delegate stake (validator key + `cspr.live/delegate-stake` CTA)
    4) Faucet (tCSPR mint)
    5) Open Position (approve + open_position)
    6) Position / Portfolio (balances + position view + close)
- Casper client/지갑 연결 레이어 구현
  - Casper Wallet provider만 사용(연결/해제, active public key 가져오기)
  - `VITE_CASPER_CHAIN_NAME=casper-test`, `VITE_CASPER_NODE_URL` 고정 사용
  - 공통 deploy 플로우:
    - `casper-js-sdk`(또는 동등)로 stored-contract call deploy 생성
    - Casper Wallet로 sign
    - node RPC로 submit + deploy hash polling(성공/실패 상태 UI 반영)
- 컨트랙트 주소/해시 구성
  - `.env` 기반(또는 `src/config/*.ts`):
    - `VITE_TCSPR_CONTRACT_HASH`
    - `VITE_MCSPR_CONTRACT_HASH`
    - `VITE_MAGNI_CONTRACT_HASH`
  - “배포 주소 세팅이 안 된 경우” UX: 안내 문구 + disabled 처리
- 기능 구현(최소)
  - Delegate stake 섹션:
    - 기본 validator key 표시 + 복사 버튼
    - `https://cspr.live/delegate-stake` 새 탭 이동 버튼
    - validator key 결정 우선순위:
      1) (T8 구현 시) `Magni.validator_public_key()` (빈 값이 아니면 최우선)
      2) `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY`
    - 간단 안내 문구: cspr.live에서 amount 입력 후 Casper Wallet로 sign/submit
  - Faucet 섹션:
    - amount 입력(18 decimals), `tCSPR.faucet_mint(to=connected_account, amount)` 실행
    - `tCSPR.balance_of`로 결과 리프레시
  - Open Position 섹션:
    - `tCSPR.balance_of` 표시 + deposit 입력
    - leverage selector: 1..=5
    - approval 상태 조회: `tCSPR.allowance(owner=user, spender=Magni)` + approve 트랜잭션
    - open 트랜잭션: `Magni.open_position(collateral_amount, leverage)`
    - 오픈 후 상태 조회:
      - `Magni.view_collateral(user)`, `Magni.view_debt(user)`, `Magni.view_leverage(user)`
      - `Magni.health_factor(user)`, `Magni.get_price()`
  - Position / Portfolio 섹션:
    - `tCSPR.balance_of(user)`, `mCSPR.balance_of(user)` 표시
    - position summary(있으면): collateral/debt/leverage/health factor/price
    - Close 버튼: `Magni.close_position()`
    - (중요 UX) “mCSPR를 외부로 보내면 close가 실패할 수 있음(컨트랙트가 burn 실행)” 경고 문구
- 공통 UX
  - 기존 프론트 알림 UX(트랜잭션 pending/success/error)를 Casper tx 플로우에 맞게 재사용/포팅
  - 입력값 파싱/포맷(18 decimals) 유틸 추가

To Do (Contracts / ABI friendliness)
- 프론트에서 다건 호출 없이 1~2번 조회로 상태를 그릴 수 있게 view helper를 추가(권장)
  - `get_position(user)` (collateral, debt, leverage, health_factor, price) 형태로 view 제공
  - (T8 완료 시) `validator_public_key()`도 portfolio/strategy 화면에 함께 노출
- 위 helper 추가 시 livenet demo(`magni_livenet`)에서도 출력/검증 포함

DoD
- `pnpm --dir casper/frontend install`
- `pnpm --dir casper/frontend dev`로 로컬 실행 가능
- Casper Wallet로 연결 후, Casper Testnet에서 다음이 end-to-end로 동작:
  1) faucet_mint로 tCSPR 받기
  2) approve 후 open_position(1..=5) 성공
  3) 포지션/잔액 조회 화면 정상 표시
  4) close_position 성공(잔액/포지션 초기화 확인)
- 커밋: "casper: add casper dapp v1 (faucet/open/view/close)"

---

## T10. Testnet all-in-one deploy script (deploy + FE wiring + CONTRACTS.md)
목표
- Casper Testnet에 컨트랙트(tCSPR/mCSPR/Magni)를 배포하고, 결과 주소(컨트랙트 해시 등)를:
  1) `casper/frontend`가 바로 읽을 수 있게 자동 반영
  2) `casper/CONTRACTS.md`에 기록
  를 한 번에 수행하는 올인원 배포 스크립트를 만든다.

To Do
- `casper/CONTRACTS.md` 생성
  - 포맷(예시):
    - Network: Casper Testnet (`casper-test`)
    - Date (UTC)
    - Node RPC URL
    - tCSPR contract hash
    - mCSPR contract hash
    - Magni contract hash
    - (선택) Styks: package hash + feed id
    - (T8 완료 시) default validator public key
- `casper/magni_casper/src/bin/magni_livenet.rs` 개선
  - 배포 결과를 **머신리더블** 하게 출력(권장: 마지막에 JSON 한 줄 출력)
    - 예: `MAGNI_DEPLOY_JSON={...}`
  - JSON에는 최소 아래를 포함:
    - `network` / `chain_name`
    - `tcspr_contract_hash`, `mcspr_contract_hash`, `magni_contract_hash`
    - (가능하면) package hash/contract package hash도 함께
  - (주의) 프론트에서 호출 가능한 식별자(보통 contract hash)를 우선 제공
- 올인원 스크립트 추가: `casper/scripts/testnet_deploy_and_wire_frontend.sh`
  - 입력: `casper/.env` (또는 env vars)
    - `ODRA_CASPER_LIVENET_SECRET_KEY_PATH`
    - `ODRA_CASPER_LIVENET_NODE_ADDRESS`
    - `ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test`
    - (선택) `STYKS_PRICE_FEED_PACKAGE_HASH`, `STYKS_PRICE_FEED_ID`
    - (선택) `DEFAULT_VALIDATOR_PUBLIC_KEY`
  - 동작:
    1) `(casper/magni_casper) cargo run --bin magni_livenet --features=livenet` 실행
    2) stdout에서 JSON을 파싱해 배포 결과 추출
    3) `casper/frontend/.env.local`(또는 `casper/frontend/.env`)에 아래를 자동 작성/갱신:
       - `VITE_CASPER_CHAIN_NAME=casper-test`
       - `VITE_CASPER_NODE_URL=<node rpc>`
       - `VITE_TCSPR_CONTRACT_HASH=<tcspr_contract_hash>`
       - `VITE_MCSPR_CONTRACT_HASH=<mcspr_contract_hash>`
       - `VITE_MAGNI_CONTRACT_HASH=<magni_contract_hash>`
       - `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY=<DEFAULT_VALIDATOR_PUBLIC_KEY>` (가능하면)
    3.1) `casper/frontend/src/config/contracts.generated.ts`도 자동 생성/갱신(동일 정보 동기화)
       - export 형태로 `chainName`, `nodeUrl`, `tcsprContractHash`, `mcsprContractHash`, `magniContractHash`, `defaultValidatorPublicKey` 제공
       - 프론트는 우선순위: `.env`(VITE_*) → `contracts.generated.ts` fallback 으로 읽도록 구성(또는 반대; 한 가지로 고정)
    4) `casper/CONTRACTS.md`에 append(또는 최신 섹션 갱신)
    5) 사람이 복붙 없이 바로 `pnpm --dir casper/frontend dev`로 실행 가능해야 함
    6) (스모크) `pnpm --dir casper/frontend build`가 깨지지 않게 보장
  - 실패 처리:
    - 필수 env 없으면 명확한 에러 메시지로 종료
    - JSON 파싱 실패 시 원인/로그 위치 안내

DoD
- (casper/magni_casper) `cargo odra test` 성공
- (casper/magni_casper) `cargo odra build` 성공
- `bash casper/scripts/testnet_deploy_and_wire_frontend.sh` 실행 후:
  - `casper/frontend/.env.local`이 생성/업데이트됨
  - `casper/CONTRACTS.md`에 주소가 기록됨
- (스모크) 아래가 성공:
  - `pnpm --dir casper/frontend install`
  - `pnpm --dir casper/frontend build`
  - (수동 확인) `pnpm --dir casper/frontend dev` 실행 후 UI에서 contract hash가 로드되고 tx 버튼이 enabled인지 확인
- 커밋: "casper: add testnet all-in-one deploy+wire script"

---

## T11. [Research Spike] “컨트랙트가 직접 CSPR delegate 가능한가?” (Casper 2.0 / Odra 2.4)
배경
- 현재 PoC는 `tCSPR(CEP-18)`을 “스테이킹 자산”으로 간주하고 `mCSPR`를 민팅하는 구조라서, **실제 Casper native staking(delegation)** 과는 분리되어 있다.
- 방향 전환: “LST 토큰 발행” 대신, **컨트랙트에 stake(= CSPR 입금)하면 컨트랙트가 validator에 delegation** 하는 vault 형태를 원함.
- 그런데 Casper는 역사적으로 “delegate는 계정(main purse) 기반”이라 **WASM 컨트랙트가 직접 delegate/undelegate 할 수 없는 제약**이 있었음(이게 2026-01-10 현재도 유효한지 먼저 확인 필요).

리서치 체크리스트(필수 링크/키워드 포함)
- Casper docs (delegation / unbonding / min delegation 500 CSPR / 7 eras):
  - https://docs.casper.network/users/delegating/
- “컨트랙트가 staking 할 수 없었다”는 논의(구현 막히는 지점 파악용):
  - https://medium.com/casper-association-r-d/casper-staking-from-smart-contract-2143df7752fc
- Odra 2.4 문서 상에는 `ContractContext::delegate / undelegate / delegated_amount` API가 존재:
  - https://docs.odra.dev/advanced-features/staking

목표
- **(가장 중요)** “stored contract(WASM) 컨텍스트”에서 native staking 호출이 실제 네트워크(casper-test)에서 가능한지/불가능한지 확정한다.
- 가능하다면: 구현 방식(필요 args, key/purse 타입, 호출 경로)을 문서화.
- 불가능하다면: 대안 아키텍처(프론트에서 유저가 직접 delegate, 또는 오프체인 operator+오라클 등)를 확정하고 후속 티켓을 그에 맞게 분기한다.

To Do
1) 최소 PoC 컨트랙트 추가(기존 Magni와 분리 권장)
   - `casper/magni_casper/src/staking_poc.rs` (또는 `src/contracts/staking_poc.rs`)
   - entrypoints:
     - `#[odra(payable)] stake(validator_public_key: String)`:
       - `let amount = self.env().attached_value();` (motes, U512)
       - `self.env().delegate(validator_public_key, amount)` 시도
     - `#[odra(payable)] request_unstake(validator_public_key: String, amount: U512)`:
       - `self.env().undelegate(validator_public_key, amount)` 시도
     - `delegated_amount(validator_public_key: String) -> U512`:
       - `self.env().delegated_amount(validator_public_key)`
2) odra-test에서 단위 테스트로 “delegate/undelegate 호출이 컴파일/동작”하는지 확인
   - 주의: odra-test가 “가능한 것처럼” 시뮬레이션 해줄 수 있어 **livenet 검증이 반드시 필요**.
3) casper-test(livenet)에서 실제로 stake가 발생하는지 검증
   - 새로운 bin 추가 권장: `casper/magni_casper/src/bin/staking_poc_livenet.rs`
   - flow:
     - deploy staking_poc
     - (caller가 CSPR 보유한 상태에서) `stake` 호출(attach CSPR)
     - RPC로 `state_get_auction_info` 확인해서 delegator가 “컨트랙트/패키지/엔티티”로 잡히는지, 혹은 트랜잭션이 revert 하는지 확인
4) 결과를 문서화
   - `casper/RESEARCH/delegation-from-contract.md` 생성
   - “가능/불가능”, 실패 시 에러(가능한 경우 revert msg/enum), 네트워크 버전/odra 버전, 재현 커맨드 포함

DoD
- “Casper testnet에서 stored contract가 직접 delegate 가능/불가능”이 **재현 가능한 형태로 확정**됨.
- 결과 문서(위 `casper/RESEARCH/...`)에:
  - 사용한 validator key / amount(motes) / deploy hash 예시
  - 성공 시 auction info 스냅샷 방법, 실패 시 에러 원인(예: main purse 부재, 시스템 컨트랙트 호출 제한 등)
  - 후속 구현 방향(아래 T12/T13 중 어떤 트랙으로 갈지) 결정
- 커밋: "casper: research delegation-from-contract feasibility"

---

## T12. [Main Track] “Vault staking” 아키텍처 확정 + Magni 설계 변경(레버리지 포함)
전제
- T11 결과를 기반으로 트랙을 선택한다.
- 목표는 “LST 토큰 발행”이 아니라 **프로토콜 내부에서 share accounting(비토큰/또는 SBT)** 로 user claim을 관리하는 것.

결정해야 할 핵심(티켓 시작 시 반드시 명시)
- (A) 컨트랙트가 직접 delegate 가능: 온체인에서 deposit→delegate, withdraw→undelegate를 직접 처리.
- (B) 컨트랙트가 직접 delegate 불가능: 아래 중 하나를 선택
  - (B1) 비수탁/유저직접: 프론트에서 유저가 auction 컨트랙트에 직접 delegate/undelegate(deploy)하고, Magni는 “레버리지/부채 토큰”만 관리(담보로서의 stake 락은 온체인에서 강제 못함).
  - (B2) 수탁/operator: 컨트랙트는 CSPR 입출금/정산만 하고, 실제 delegate/undelegate는 오프체인 operator 계정이 수행(필요 시 oracle/reporting 추가). 신뢰 가정이 생김.

목표(공통)
- “레버리지 스테이킹”을 현재 구조(= `mCSPR` 민팅/버닝)로 계속 지원하되,
  - 담보/스테이킹 자산 단위를 **native CSPR(motes)** 로 정리(가능하면 tCSPR 의존 제거)
  - close가 즉시 불가할 수 있는 **unbonding delay(예: 7 eras)** 를 UX/상태머신으로 반영

To Do (권장 설계 초안 — Claude가 구현 전에 확정)
1) 단위/데시멀 정리
   - Casper staking은 “motes(U512, 1 CSPR = 1e9 motes)” 단위.
   - 현재 컨트랙트는 18 decimals(U256) 기반이므로, 아래 중 하나로 정리:
     - (권장) 컨트랙트 내부 금액은 motes(U512)로 통일, 프론트에서 표시만 변환
     - (대안) 내부는 18 decimals 유지하되, staking 호출 시 motes로 변환(실수 위험 큼)
2) Magni 포지션 모델 재정의(현재 코드/티켓 간 수학 불일치 해결)
   - “LTV=80%에서 5x 레버리지”를 일관되게 정의:
     - deposit(유저 equity) = D
     - target leverage = L (1..=5)
     - total_staked = D * L
     - debt = D * (L - 1)
     - 이때 `debt / total_staked = (L-1)/L` 이고, L=5면 0.8로 LTV와 정확히 일치
3) (A 트랙) vault stake 상태머신(예시)
   - `open_position(leverage)` 는 `#[odra(payable)]`:
     - attach D motes
     - (레버리지>1이면) vault reserve에서 B = D*(L-1) motes를 “대여”로 할당
     - delegate total_staked = D + B 를 validator로 delegate
     - mCSPR를 debt만큼 민팅(단위/데시멀 결정에 따라 변환)
   - `request_close_position()`:
     - undelegate(total_staked)
     - unbonding 완료 전까지 `close_position()`은 revert 또는 “pending” 상태 반환
   - `finalize_close_position()`:
     - (unbond 완료 후) withdraw 가능한 CSPR를 받아:
       - debt에 해당하는 B는 reserve로 반환
       - 나머지(원금+보상)는 유저에게 반환(또는 보상 정책 정의)
     - mCSPR burn
4) reserve(레버리지 유동성) 설계
   - 즉시 레버리지를 제공하려면 reserve는 **un-staked liquid CSPR** 여야 함(스테이킹해두면 언본딩 때문에 즉시 대여 불가).
   - 최소 구현:
     - `#[odra(payable)] provide_reserve()` / `withdraw_reserve(amount)` (owner-only로 시작 가능)
     - `reserve_available` 추적
5) view/API 친화성(프론트/스크립트용)
   - `get_position(user)` 형태로 한 번에 조회 가능한 struct 제공:
     - 상태(open / closing_pending / closed)
     - equity(D), debt(B), total_staked, validator, timestamps(era info는 가능하면)
     - (A 트랙) delegated_amount / unbonding 상태(가능한 범위)

DoD
- 설계 결정(A/B1/B2)과 근거가 `casper/PROJECT.md` 또는 `casper/RESEARCH/...`에 반영됨.
- 선택된 트랙 기준으로, “open→(pending)→close” 플로우가 명확한 상태머신과 entrypoints로 정의됨.
- 커밋: "casper: define vault-staking architecture and update magni design"

---

## T13. (트랙별 구현) 컨트랙트/프론트 엔드투엔드 플로우 구성
목표
- T12에서 확정한 트랙 기준으로 **실제 사용 가능한 UX** 를 만든다.

트랙 A(온체인 delegate 가능) 구현 To Do(요약)
- Contracts
  - `casper/magni_casper/src/magni.rs`를 “native CSPR payable + vault staking” 구조로 리팩터
  - 기존 `tCSPR` 기반 collateral 로직 제거 또는 데모 전용으로 격리
  - unit tests:
    - open_position(L=1..=5) 동작
    - request_close → (era 경과 시뮬레이션 가능하면) finalize_close
    - reserve 부족 시 revert
- Frontend
  - “Delegate stake” CTA 제거(또는 “컨트랙트가 자동 delegate” 안내로 변경)
  - Open Position 시 attach CSPR 입력(단위: CSPR, 내부는 motes로 변환)
  - Close는 2-step(요청/완료) UI로 분리

트랙 B1(유저 직접 delegate) 구현 To Do(요약)
- Frontend에 “Delegate/Undelegate”를 cspr.live 링크 대신 **직접 트랜잭션 생성**으로 구현
  - auction 컨트랙트 hash를 env로 주입(`VITE_AUCTION_CONTRACT_HASH`)
  - entrypoints:
    - `delegate(delegator, validator, amount)`
    - `undelegate(delegator, validator, amount)`
  - Casper docs의 unbonding delay/최소금액(500 CSPR) 안내 문구 추가
- Contracts는 기존 PoC( tCSPR + mCSPR ) 유지하되,
  - “이 포지션은 실제 stake를 온체인에서 락하지 않는다”는 경고를 문서/프론트에 명시

트랙 B2(operator) 구현 To Do(요약)
- Contracts
  - stake deposit/withdraw 요청을 이벤트로 남김
  - operator address 설정(owner-only) + emergency withdraw rails
- Off-chain (스크립트/서비스)
  - 이벤트 감시 → operator 키로 delegate/undelegate 실행
  - 결과(era/amount/완료)를 contract에 report(필요 시)하거나, 최소는 human-operated로 문서화

DoD
- 선택 트랙 기준으로 Testnet에서 end-to-end 데모 가능:
  - 트랙 A: open(attach CSPR) → delegate 확인 → close(언본딩 반영)
  - 트랙 B1: dApp에서 delegate tx 실행 → (별도) open/close PoC 실행
  - 트랙 B2: deposit 이벤트 → operator delegate → withdraw 이벤트 처리
- 커밋: "casper: implement end-to-end staking flow (selected track)"

---

# V2 — CSPR Vault (담보대출) + Staking Delegate (Swap loop은 외부 구현)

배경
- 현재 `Magni`(staking-based leverage PoC)는 `open_position(leverage)` 중심의 “레버리지 포지션” 모델이다.
- V2는 이를 **일반적인 담보대출(vault)** 모델로 재설계한다:
  - 유저는 CSPR을 예치(= 담보)하고, 프로토콜은 예치분을 delegate로 staking 운용.
  - 유저는 담보가치 기준 **LTV 80%까지 mCSPR(부채 토큰)** 을 발행(= borrow)할 수 있다.
  - mCSPR 부채에는 **연 2% 이자**가 누적된다.
  - 유저는 **담보비율을 유지하는 한** 담보(CSPR)를 인출할 수 있고, 담보 추가/부채 상환은 언제든 가능하다.
- “레버리지의 핵심인 mCSPR → (외부 SwapPool) → CSPR → 재예치 반복”은 **외부에서 구현**하므로 컨트랙트 범위에서 제외한다.

V2 핵심 가정(티켓 시작 시 확정해서 문서에 박아야 함)
- 가격(Oracle):
  - 기본은 **1 mCSPR = 1 CSPR (nominal)** 로 가정하고 LTV 계산도 1:1로 한다(오라클 불필요).
  - 오라클 기반(USD) LTV는 V2 범위에서 제외(추후 티켓으로 분리).
- 단위/데시멀:
  - CSPR native transfer/staking는 motes(`U512`, 1 CSPR = 1e9 motes).
  - mCSPR는 18 decimals(`U256`) 유지.
  - 따라서 **정확한 변환 규칙**(motes ↔ 18 decimals)을 컨트랙트에 명시적으로 둔다(“그냥 캐스팅” 금지).
- 출금 UX:
  - Casper staking은 undelegate 후 unbonding delay가 있으므로, 출금은 기본적으로 **2-step**(`request_withdraw` → `finalize_withdraw`) 상태머신을 갖는다.
  - 단, 컨트랙트에 liquid CSPR가 남아있는 경우(예: batching/가스/최소 delegation 처리로 인해) 즉시 finalize가 가능할 수 있다.

---

## T14. V2 스펙 고정 + 상태/인터페이스 설계서 작성
목표
- V2 컨트랙트 인터페이스/상태머신/단위/이자 모델을 **코드 작성 전에** 고정한다(Claude 구현 기준 문서).

To Do
- `/casper/PROJECT.md`에 V2 스펙 섹션 추가(또는 새 문서 `casper/RESEARCH/v2-vault-spec.md` 생성):
  - 용어 정의: collateral/debt/LTV/health factor/unbonding/pending withdraw
  - 단위 정의:
    - `motes`(U512) ↔ `wad`(18 decimals, U256) 변환식과 반올림 규칙(항상 유저에게 불리하지 않게)
  - 이자 모델:
    - 2% APR을 “초당 단리(simple interest)”로 누적할지, “index 기반 누적(사실상 compounding)”으로 할지 선택
    - 반드시 on-demand accrual(유저 액션 시) + `last_accrual_timestamp`/`index` 저장 방식 명시
  - 상태머신:
    - deposit/add_collateral
    - borrow
    - repay
    - request_withdraw(undelegate)
    - finalize_withdraw(언본딩 완료 후 transfer)
  - 불변조건(invariants) 명시:
    - `debt_with_interest(user) <= collateral_value(user) * 0.8` (모든 상태 전이 후)
    - 상환 후 debt는 절대 음수가 되지 않음(언더플로 방지)
    - `mCSPR.total_supply`와 전체 부채(합산)가 일치(또는 명시적 차이가 있으면 이유 기록)
  - 이벤트/에러 enum 초안
  - “외부 Swap loop은 범위 밖”을 명시

DoD
- 설계서에 **entrypoint 시그니처(함수명/인자/단위)** 가 고정되어 있고, Claude가 그대로 구현할 수 있음.
- 커밋: "docs(casper): define V2 vault spec and invariants"

---

## T15. (V2) Magni 컨트랙트 리디자인: Vault + Borrow/Repay/Withdraw(2-step)
목표
- `open_position(leverage)` 중심 PoC를 V2 vault 모델로 교체(또는 신규 모듈로 분리)한다.

To Do (권장 엔트리포인트 — T14에서 확정)
- Core (유저)
  - `#[odra(payable)] deposit()`:
    - `attached_value`를 collateral에 반영
    - (트랙 A) 가능하면 delegate로 staking(최소 delegation/batching 정책은 T17에서)
  - `#[odra(payable)] add_collateral()`:
    - deposit의 alias(UX 편의)
  - `borrow(amount_mcspr_wad: U256)`:
    - interest accrual 수행
    - `debt_after <= collateral * LTV_MAX` 체크
    - mCSPR mint to user
  - `repay(amount_mcspr_wad: U256)`:
    - interest accrual 수행
    - 권장 방식: `mCSPR.transfer_from(user, self, amount)` 후 `mCSPR.burn(self, amount)`
      - (이유) “유저가 토큰을 외부로 보내면 close가 실패” 같은 UX 폭탄 제거
  - `request_withdraw(amount_motes: U512)`:
    - interest accrual 수행
    - 출금 후 LTV 체크(담보 감소 후에도 안전해야 함)
    - 충분한 liquid balance가 없으면 `undelegate`를 트리거하고 pending 상태로 기록
  - `finalize_withdraw()` 또는 `finalize_withdraw(request_id)`:
    - 언본딩 완료로 liquid balance가 확보되면 CSPR transfer
    - pending 상태 정리
- Admin (owner)
  - `set_validator_public_key(new_key: String)`
  - `pause()` / `unpause()`
  - (옵션) `set_ltv_max_bps(8000)` / `set_interest_rate_bps(200)` (초기엔 상수 고정도 OK)
- Views
  - `get_position(user)`:
    - collateral(가능하면 motes + wad 둘 다 or 한 쪽으로 통일)
    - debt_principal + debt_with_interest
    - LTV / health_factor
    - pending_withdraw 정보
  - `self_balance()` / `delegated_amount()` 등 디버그용 유지

비고(구현 시 결정)
- 기존 `Magni`(leverage PoC)를 완전히 교체할지, `MagniLeverage`로 파일/모듈을 분리해서 남길지 선택.
  - V2 출시가 목표면 PoC 엔트리포인트는 제거/비공개 처리 권장(프론트 혼선 방지).

DoD
- V2 엔트리포인트가 컴파일/배포 가능하고, “deposit→borrow→repay→withdraw(2-step)” 흐름이 contract 레벨에서 성립.
- 커밋: "feat(contracts): implement V2 CSPR vault (deposit/borrow/repay/withdraw)"

---

## T16. (V2) 이자(2% APR) 누적 로직 구현 + 정밀도/반올림 규칙 확정
목표
- mCSPR 부채가 시간에 따라 2% APR로 누적되도록 한다(정확히 “언제/어떻게” 증가하는지 투명).

To Do
- 선택한 모델에 맞춰 구현:
  - (A) per-user: `debt_principal`, `last_accrual_ts`를 두고, 액션 시 `debt = debt + debt*rate*dt/year`
  - (B) global index: `debt_index`, `last_accrual_ts`, per-user `scaled_debt`(RAY) 방식
- `accrue_interest(user)`를 모든 상태변이 함수 시작 시 호출(또는 modifier 유사 패턴).
- rounding:
  - 이자 계산은 overflow/underflow 방지.
  - rounding 방향을 명시(보수적으로 “프로토콜 유리”로 하되 UX/정합성 설명 포함).

DoD
- 단위 테스트에서 시간 경과 시 debt 증가가 확인됨(허용 오차 포함).
- 커밋: "feat(contracts): add 2% APR interest accrual for mCSPR debt"

---

## T17. (V2) Staking delegate/undelegate 정책(최소 delegation, batching, partial withdraw)
목표
- “예치된 CSPR을 delegate해서 staking 굴린다”를 V2 상태머신과 모순 없이 구현한다.

To Do
- Casper 최소 delegation(500 CSPR) 제약을 고려한 정책 선택(문서에 명시):
  - (권장) pooled delegation + batching:
    - deposit이 들어오면 내부 `pending_to_delegate_motes`에 쌓고, 500 CSPR 이상이 되면 `delegate` 실행
  - withdraw 요청이 오면:
    - 우선 liquid balance로 처리 가능하면 즉시 finalize 허용
    - 부족하면 `undelegate` 실행 + pending withdraw로 전환
- `undelegate`는 “총 delegated pool에서 일부”를 빼는 것이므로, user별 pending 금액만 추적하면 됨.
- 이벤트:
  - `DelegationTriggered(amount)`
  - `UndelegationRequested(amount, user)`

DoD
- “500 CSPR 미만 예치”도 받아서 accounting은 되지만, staking/출금은 정책대로 동작(문서/테스트로 명확).
- 커밋: "feat(contracts): add delegation batching and withdraw unbonding flow"

---

## T18. (V2) 테스트 강화 (OdraVM)
목표
- V2의 핵심 불변조건/엣지케이스를 테스트로 고정한다(Claude 구현의 안전망).

To Do (필수 테스트 케이스)
- 기본 플로우
  - deposit → borrow(max 80%) 성공
  - repay(partial/full) 성공
  - request_withdraw(안전범위) 성공 + finalize_withdraw(언본딩 후) 성공
- 실패 케이스
  - borrow가 LTV 초과하면 revert
  - withdraw가 LTV 초과하면 revert
  - repay가 allowance/잔고 부족이면 revert
- 이자
  - 시간 경과 후 debt 증가
  - repay가 먼저 이자를 반영한 후 감소(순서 보장)
- 단위/데시멀
  - motes↔wad 변환이 일관되고, 캐스팅으로 인한 1e9/1e18 단위 오류가 재발하지 않음

DoD
- `(casper/magni_casper) cargo odra test`에서 V2 테스트들이 안정적으로 통과.
- 커밋: "test(contracts): add V2 vault invariants and flows"

---

## T19. (V2) Livenet 데모/배포 스크립트 업데이트
목표
- Casper testnet에서 V2 흐름을 재현 가능한 스크립트/바이너리로 만든다.

To Do
- `magni_livenet`(또는 신규 `vault_livenet`) 플로우:
  - deploy mCSPR + V2 Magni
  - set_minter(V2 Magni)
  - deposit(attach CSPR) → borrow → repay → request_withdraw
  - (언본딩 기다림은 자동화가 어렵다면) “대기 후 finalize”를 별도 모드로 분리
- `casper/DEPLOY.md`, `casper/CONTRACTS.md` 출력 포맷/주소 주입 갱신

DoD
- 최소 1회 이상 testnet에서 end-to-end 로그가 남고, 재현 커맨드가 문서화됨.
- 커밋: "chore(casper): update livenet demo for V2 vault flow"

---

## T20. (V2) Frontend UX 리워크 (deposit/borrow/repay/withdraw)
목표
- 프론트가 더 이상 `open_position(leverage)`/`close_position()` 같은 PoC 엔트리포인트를 호출하지 않도록 정리하고,
  V2 vault UX를 제공한다.

To Do
- 화면/액션
  - Deposit(attach CSPR), Borrow(mCSPR), Repay(mCSPR), Withdraw(요청/완료 2-step)
  - Position 카드: collateral, debt(with interest), LTV, health factor, pending withdraw 상태
- 토큰 UX
  - Repay는 `approve` → `repay(amount)` 흐름(allowance 표시 포함)
- 환경변수/주소
  - `VITE_*_CONTRACT_HASH` 등 최신 엔트리포인트/컨트랙트 이름 반영

DoD
- `pnpm --dir casper/frontend build` 성공
- testnet에서 최소 1회 “deposit/borrow”까지 실제 트랜잭션이 찍힘(Withdraw finalize는 언본딩 상황에 따라 데모 단계에서 분리 가능).
- 커밋: "feat(frontend): add V2 vault UX (deposit/borrow/repay/withdraw)"
