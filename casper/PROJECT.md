# Magni x Casper — Hackathon Prototype (Odra + Styks Oracle)

## 목표
Casper Testnet에서 동작하는 Leverage Staking 프로토타입을 구현한다.
- 제출물: Casper Testnet에서 동작하는 프로토타입 + public GitHub + demo video

## 해커톤용 최소 설계
- 담보 자산: tCSPR(CEP-18 테스트 토큰) = “스테이킹 자산”으로 간주(단순화)
- 합성자산: mCSPR(CEP-18) — Magni 컨트랙트만 mint/burn
- 레버리지 루프:
  1) tCSPR 예치(= stake & collateralize)
  2) mCSPR 민트(= borrow)
  3) mCSPR -> tCSPR 스왑(POC는 1:1 swap로 단순화)
  4) 재예치
  5) 목표 레버리지 도달 (LTV=80% -> Max 5x)

## Oracle: Styks(Odra)
- Styks는 Casper Testnet에 배포된 Odra 기반 오라클.
- Magni 컨트랙트에서 StyksPriceFeed의 `get_twap_price(feed_id)`를 external contract 호출로 직접 읽는다.
- feed_id 기본값: CSPRUSD (env로 주입)

## 파라미터(POC)
- LTV = 80% (max 5x)
- Minting Fee = 1%
- Fixed Interest = 2% APR (POC 단순 누적)
- Liquidation Fee = 7.5% (옵션)

## 데모에서 반드시 보여줄 것
- Deploy: tCSPR / mCSPR / Magni 배포
- Oracle: Styks TWAP price read (로그 출력)
- Flash Open: 5x 포지션 오픈
- View: collateral / debt / LTV / accrued interest + oracle price 표시
- Close: repay + withdraw로 종료

## DoD
- cargo odra test 통과
- Casper Testnet에서:
  - 배포 성공
  - Styks price read 성공(없으면 None으로 graceful handling)
  - 5x open/view/close 성공
