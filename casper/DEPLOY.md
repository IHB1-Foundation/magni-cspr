# Deploy (Casper Testnet) — All-in-one script

이 문서는 Casper Testnet에 **staking 기반** `mCSPR` / `Magni`를 배포하고, 프론트(`casper/frontend`)에 주소를 자동 반영하며, `casper/CONTRACTS.md`에 기록까지 남기는 절차를 “그대로 복붙해서 실행”할 수 있게 정리한다.

## 0) 사전 준비물

- **Casper Testnet CSPR** (배포 수수료용)
- **secret key 파일** (`secret_key.pem`) 경로
- **Node RPC URL**
  - 권장: `https://node.testnet.casper.network` (주의: `/rpc` 붙이지 말 것 — Odra가 내부에서 `/rpc`를 붙임)
- **Events URL** (Odra 요구사항)
  - `ODRA_CASPER_LIVENET_EVENTS_URL`는 현재 Odra가 “필수 env”로 강제한다.
  - 이 repo에서는 이벤트 스트림을 직접 쓰지 않으므로(현재 odra-casper-rpc-client 2.4.0 기준), 접근 가능한 URL 문자열이면 된다.
- (선택) **Default validator public key**
  - delegate-stake 안내용.

## 1) (처음 1회) 로컬 개발 도구 설치

```bash
# Rust / Odra / wasm toolchain 설치
bash casper/scripts/setup.sh
```

`setup.sh`는 다음을 설치/안내한다:
- `rustup`이 있어야 함
- `nightly-2025-01-05` + `wasm32-unknown-unknown`
- `cargo-odra`
- (선택) `casper-client`
- (권장) `wasm-opt`(binaryen), `wasm-strip`(wabt)

## 2) (처음 1회) 키 생성 (secret_key.pem)

이미 testnet 배포용 키가 있으면 이 단계는 스킵해도 된다.

```bash
# casper-client가 없다면 setup.sh에서 설치를 시도(옵션)
command -v casper-client >/dev/null || cargo install casper-client

# keys/ 디렉토리에 keypair 생성
mkdir -p keys
casper-client keygen keys

# 생성된 파일 확인
ls -la keys
# keys/secret_key.pem 이 있어야 함
```

## 3) (필수) 배포 환경변수 설정

### 옵션 A) `casper/.env` 파일로 관리(권장)

```bash
cp casper/.env.example casper/.env
```

`casper/.env`를 열어서 아래를 채운다:

```bash
# ---- Casper Testnet (Odra Livenet) ----
ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/ABS/PATH/to/secret_key.pem
ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.casper.network
ODRA_CASPER_LIVENET_EVENTS_URL=https://node.testnet.casper.network/events
ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test

# Payment limits (motes). 1 CSPR = 1_000_000_000 motes.
# NOTE (Casper 2.0): payment is held ("gas hold") for a period (testnet currently: 24h),
# so setting this too high can temporarily lock your whole balance.
# NOTE: testnet block gas limit is 812_500_000_000 — if you set above this you'll get "exceeds the networks block gas limit".
ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN=450_000_000_000
ODRA_CASPER_LIVENET_DEPLOY_GAS_MAGNI=600_000_000_000
ODRA_CASPER_LIVENET_CALL_GAS=50_000_000_000

# Legacy fallback (used if per-step vars above are missing)
ODRA_CASPER_LIVENET_GAS=450_000_000_000

# ---- Default validator (optional) ----
DEFAULT_VALIDATOR_PUBLIC_KEY=012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80
```

그리고 실행 전에 env 로드:

```bash
set -a
source casper/.env
set +a
```

### 옵션 B) 터미널에서 직접 export

```bash
export ODRA_CASPER_LIVENET_SECRET_KEY_PATH="/ABS/PATH/to/secret_key.pem"
export ODRA_CASPER_LIVENET_NODE_ADDRESS="https://node.testnet.casper.network"
export ODRA_CASPER_LIVENET_CHAIN_NAME="casper-test"
export ODRA_CASPER_LIVENET_EVENTS_URL="https://node.testnet.casper.network/events"

export ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN="450_000_000_000"
export ODRA_CASPER_LIVENET_DEPLOY_GAS_MAGNI="600_000_000_000"
export ODRA_CASPER_LIVENET_CALL_GAS="50_000_000_000"
export ODRA_CASPER_LIVENET_GAS="450_000_000_000"

export DEFAULT_VALIDATOR_PUBLIC_KEY="012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80"
```

## 4) (필수) Testnet에 컨트랙트 배포 + 프론트 자동 반영 + 기록

```bash
bash casper/scripts/testnet_deploy_and_wire_frontend.sh
```

이 스크립트는 한 번에 아래를 수행한다:
- `cargo odra build`로 wasm 생성
- `MAGNI_LIVENET_MODE=deploy cargo run --bin magni_livenet --features=livenet`로 배포 실행(데모 트랜잭션 스킵)
- 배포 결과(JSON)를 파싱
- 프론트 설정 자동 생성/갱신
  - `casper/frontend/.env.local`
  - `casper/frontend/src/config/contracts.generated.ts`
- `casper/CONTRACTS.md`에 배포 주소 기록 추가
- (스모크) 프론트 빌드 성공 여부 확인
  - `pnpm install`
  - `pnpm frontend:build`

## 5) 프론트 실행 & 수동 스모크(권장)

```bash
pnpm frontend:dev
```

브라우저에서 확인:
- 기본 dev URL: `http://127.0.0.1:5173`
- Contracts 섹션에 contract hash들이 로드되는지
- Casper Wallet 연결 후 버튼들이 enabled 되는지
- (E2E) deposit → borrow → (mCSPR approve) → repay → request_withdraw → finalize_withdraw 흐름으로 확인
  - NOTE: `finalize_withdraw()`는 언본딩이 끝나기 전에는 실패할 수 있다.

## 6) 배포 결과 확인(파일)

- 최신 배포 기록: `casper/CONTRACTS.md`
- 프론트 env: `casper/frontend/.env.local`
- 프론트 상수: `casper/frontend/src/config/contracts.generated.ts`

## 7) (권장) 프론트 호스팅 (Vercel) — `/rpc` 프록시로 CORS 회피

Casper 노드 RPC(`https://node.*.casper.network/rpc`)는 보통 CORS 헤더를 제공하지 않아서, 브라우저에서 직접 호출하면 `Failed to fetch`가 뜨며 **잔고 조회/트랜잭션 제출이 실패**할 수 있다.

이 repo는 Vercel 호스팅을 위해 아래를 포함한다:
- `casper/frontend/api/rpc.js`: 서버리스 JSON-RPC 프록시
- `casper/frontend/vercel.json`: `/rpc` → `/api/rpc` rewrite

즉, 프론트는 **same-origin** `POST /rpc`로 호출하고, Vercel이 서버에서 Casper 노드로 대신 요청한다.

### 7.1) Vercel 프로젝트 설정

Vercel에서 새 프로젝트를 만들 때:
- **Root Directory**: `casper/frontend`
- **Install Command**: `pnpm install`
- **Build Command**: `pnpm build`
- **Output Directory**: `dist`

### 7.2) Vercel 환경변수(필수)

Vercel Project → Settings → Environment Variables 에 아래를 추가:

```bash
# Casper node JSON-RPC upstream (권장: testnet)
CASPER_NODE_RPC_URL=https://node.testnet.casper.network/rpc
```

메인넷으로 바꾸려면:

```bash
CASPER_NODE_RPC_URL=https://node.mainnet.casper.network/rpc
```

### 7.3) 프론트 설정값(VITE_*)에 대해

Vite의 `import.meta.env.VITE_*` 값은 **빌드 타임에만** 주입된다.

이 repo는 `casper/frontend/src/config/contracts.generated.ts`를 fallback으로 사용하므로,
가장 간단한 운영 방법은:
- 4) 스크립트(`testnet_deploy_and_wire_frontend.sh`)로 배포 후 `contracts.generated.ts`가 갱신된 상태로 프론트를 빌드/배포

혹은 Vercel에 아래 `VITE_*`를 직접 넣어서 override 해도 된다:
- `VITE_CASPER_CHAIN_NAME`
- `VITE_CASPER_NODE_URL` (권장: 비워두거나 `/rpc` 사용 — same-origin 프록시)
- `VITE_MCSPR_CONTRACT_HASH`
- `VITE_MAGNI_CONTRACT_HASH`
- `VITE_DEFAULT_VALIDATOR_PUBLIC_KEY`

## (옵션) Token 재배포 없이 Magni만 재배포/복구

이미 `mCSPR`가 배포되어 있고(예: gas-hold 때문에 중간에 멈춘 경우), 토큰은 재사용하고 `Magni`만 다시 배포하고 싶다면:

```bash
# casper/.env 에 추가 (64-hex, 또는 hash-..., contract-package-... 형식 모두 가능)
MAGNI_EXISTING_MCSPR=<mcspr_contract_hash_hex>
```

그 후 다시:

```bash
bash casper/scripts/testnet_deploy_and_wire_frontend.sh
```

## Troubleshooting

### RPC 401 에러
- 이 repo 기본 RPC는 `https://node.testnet.casper.network`를 사용한다.
- 만약 다른 RPC를 쓰는 경우, Odra는 base URL에 `/rpc`를 붙이므로 `.../rpc`까지 넣지 말 것.

### "exceeds the networks block gas limit"
- `ODRA_CASPER_LIVENET_*_GAS` 값을 너무 크게 잡은 경우다.
- testnet의 `transactions.block_gas_limit`은 `812_500_000_000` (motes)이다.

### "Insufficient funds" (특히 token 2개 배포 후)
- Casper 2.0의 gas-hold 메커니즘 때문에, **각 트랜잭션의 payment limit이 일정 기간(현재 24h) 잠길 수 있다.**
- 해결:
  - faucet으로 testnet CSPR를 더 충전하거나,
  - `ODRA_CASPER_LIVENET_DEPLOY_GAS_TOKEN / _MAGNI / _CALL_GAS`를 가능한 낮게 조정한다.

### 프론트에 contract hash가 비어있음
- 스크립트가 성공했는지 확인하고,
  - `casper/frontend/.env.local`과 `casper/frontend/src/config/contracts.generated.ts`가 생성/갱신됐는지 확인.

### withdraw/finalize가 실패함
- V2 vault는 `request_withdraw(amount_motes)` → (unbonding delay) → `finalize_withdraw()` 2-step이다.
- `finalize_withdraw()`는 언본딩이 끝나기 전에는 실패할 수 있다(컨트랙트 liquid balance 부족).
- `request_withdraw()`는 withdraw 후에도 LTV(80%)가 유지되어야 하므로, 부채가 큰 상태에서 과도하게 요청하면 revert 한다.
