# Magni Protocol (Casper Testnet) — Demo Scenario (Casper Wallet)

1. Install Casper Wallet browser extension and make sure it is unlocked.
2. In Casper Wallet, switch the network to Testnet (`casper-test`) and select the account you will use for the demo.
3. Fund the demo account with Casper Testnet CSPR (recommended: 700+ CSPR so you can deposit and still have fees).
4. Confirm the frontend has contract hashes configured: open `casper/frontend/.env.local` and verify `VITE_MCSPR_CONTRACT_HASH` and `VITE_MAGNI_CONTRACT_HASH` are set (if missing/empty, deploy & wire first with `bash casper/scripts/testnet_deploy_and_wire_frontend.sh`).
5. Start the dApp locally: from repo root run `pnpm install`, then `pnpm frontend:dev`, then open `http://127.0.0.1:5173`.
6. In the app’s Wallet card, click Connect Wallet.
7. In the Casper Wallet popup, approve the connection request.
8. Confirm the app is connected: the Wallet card shows your active public key and CSPR balance, and the Contracts card shows non-empty hashes for mCSPR and Magni V2.

9. Go to the **Deposit** page (top nav → **Deposit**).
10. In **Deposit**, enter `500` CSPR (minimum deposit is 500 CSPR) and click **Deposit**.
11. In Casper Wallet, review the deploy details and **Sign**.
12. Wait until the UI shows the transaction as **Success** (it will also display a deploy hash).
13. Verify deposit worked: go to Portfolio and confirm Vault Position shows Status = Active and Collateral ≈ 500 CSPR.

14. Go back to the **Deposit** page and find the **Borrow** section.
15. Confirm **Max borrow available** is greater than 0.
16. Enter a small borrow amount (example: `50` mCSPR) and click **Borrow**.
17. In Casper Wallet, **Sign** the borrow deploy.
18. Verify borrow worked: in Portfolio confirm mCSPR balance increased, and in Vault Position confirm Debt increased and LTV is updated.

19. In the **Repay** section, enter a repay amount (example: `10` mCSPR).
20. Click **Approve** (Step 1) and **Sign** in Casper Wallet (this approves the Magni contract to spend your mCSPR).
21. After **Approve** succeeds, click **Repay** (Step 2) and **Sign** in Casper Wallet.
22. Verify repay worked: Debt decreases, your mCSPR balance decreases, and LTV updates.

23. Optional (close all debt): click Approve All (sign), then Repay All (sign), then confirm Debt = 0 in Vault Position.

24. In the **Withdraw** section, enter a small withdrawal amount (example: `50` CSPR) and click **Withdraw**.
25. In Casper Wallet, **Sign** the withdraw request deploy.
26. Verify withdraw request worked: Vault Position shows Status = Withdrawing and a Pending Withdraw amount.
27. Explain the 2-step withdrawal: the protocol requires an unbonding delay (~14 hours on testnet) before funds can be finalized.
28. (Optional, after unbonding) Click **Finalize Withdraw** and sign in Casper Wallet.
29. Verify finalize worked: Pending Withdraw clears (back to 0) and your wallet CSPR balance increases (minus gas).

30. For any step, open the deploy hash in the Casper explorer (Testnet) and verify it was executed successfully: `https://testnet.cspr.live/`.
