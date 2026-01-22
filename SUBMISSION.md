# Magni Protocol - Hackathon Submission

## Project Summary

**Magni** is a collateral-debt vault protocol on Casper Network that allows users to:
- Deposit CSPR as collateral (auto-delegated to validators for staking rewards)
- Borrow mCSPR synthetic tokens at up to 80% LTV
- Keep earning staking yields while accessing liquidity

**Team:** Solo developer
**Category:** DeFi / Staking
**Network:** Casper Testnet

---

## 3-Minute Demo Script

This script walks through the complete user journey. Use testnet with real wallet for live demo, or use Demo Mode if wallet/network issues occur.

### Prerequisites
- Casper Wallet browser extension
- Testnet CSPR (get from https://testnet.cspr.live/tools/faucet)
- The app running at http://localhost:5173 (or deployed URL)

### Demo Steps

#### 1. Landing Page (0:00 - 0:30)

1. **Open the app** - Show the landing page hero
2. **Highlight key metrics**: 80% LTV, 2% APR, 500 CSPR minimum
3. **Click "How It Works"** - Show the explainer page with diagrams
4. **Click "Get Started"** to go to the deposit page

#### 2. Connect Wallet (0:30 - 1:00)

1. **Show the onboarding stepper** in the sidebar (tracks progress)
2. **Click "Connect Wallet"** - Casper Wallet popup appears
3. **Approve connection** - Stepper updates to show wallet connected
4. **Point out**: Balance appears, network verified, contracts configured

#### 3. Deposit CSPR (1:00 - 1:30)

1. **Enter deposit amount**: 500 CSPR (minimum for delegation)
2. **Click "Deposit"** - Sign in wallet
3. **Wait for confirmation** - Toast notification shows success
4. **Show updated vault**: Collateral now shows 500 CSPR
5. **Explain**: "Your CSPR is now delegated to validators earning staking rewards"

#### 4. Borrow mCSPR (1:30 - 2:00)

1. **Show max borrow available**: 400 mCSPR (80% of 500)
2. **Enter borrow amount**: 200 mCSPR
3. **Click "Borrow"** - Sign in wallet
4. **Wait for confirmation** - Toast shows success
5. **Show updated vault**: LTV now at 40%, debt shows 200 mCSPR
6. **Point out mCSPR balance** in wallet

#### 5. Repay & Withdraw (2:00 - 2:30)

1. **Show "Repay" section**: Current debt displayed
2. **Click "Approve All" then "Repay All"** (or partial repay)
3. **After repay, show "Withdraw" section**
4. **Explain 2-step process**: "Due to Casper unbonding, withdrawals are 2-step"
5. **Click "Withdraw Max"** - Request submitted
6. **Show pending state**: "Withdrawal Pending" banner appears
7. *(Optional if time permits)* After unbonding (~2 mins on testnet in certain conditions), click "Finalize"

#### 6. Extra Features (2:30 - 3:00)

1. **Toggle theme**: Click theme button in nav (Dark/Light/System)
2. **Show Portfolio page**: Dashboard with KPIs and trend charts
3. **Show Activity**: Transaction history with explorer links
4. **Mention Demo Mode**: "Users can try the full UX without a wallet"

---

## Fallback: Demo Mode

If wallet connection or testnet has issues, use Demo Mode:

1. **Open the app** - Go to Deposit page
2. **In the sidebar**, find "Getting Started" stepper
3. **Click "Demo Mode"** link at the bottom
4. **Purple banner appears**: "Demo Mode - Using mocked data"
5. **Explore all features** with pre-populated data:
   - Vault with 10,000 CSPR collateral
   - 5,000 mCSPR debt
   - 50% LTV
   - Activity history
   - Dashboard charts
6. **Click "Exit Demo"** in the banner to return to normal mode

---

## Technical Highlights

### Smart Contracts (Rust/Odra)
- **mCSPR**: CEP-18 standard token with controlled minting
- **Magni**: Vault with deposit, borrow, repay, and 2-step withdraw
- **Delegation**: Automatic staking to validator on deposit

### Frontend (React/TypeScript)
- **Vite + TypeScript**: Fast development and type safety
- **casper-js-sdk**: Native Casper integration
- **Zero heavy dependencies**: Custom SVG charts, CSS animations
- **Accessibility**: Keyboard navigation, ARIA labels, reduced-motion support

### UX Polish
- **Progressive onboarding**: Step-by-step guide for new users
- **Transaction feedback**: Toasts, modals, activity history
- **Loading states**: Skeletons and empty states
- **Error handling**: Global error boundary with retry

---

## How to Run

```bash
# Install dependencies
pnpm install

# Run frontend (uses deployed testnet contracts)
pnpm --dir casper/frontend dev

# Build for production
pnpm --dir casper/frontend build
```

App runs at http://localhost:5173

---

## Links

- **Repository**: [github.com/your-username/magni-casper]
- **Live Demo**: [your-deployment-url]
- **Testnet Contracts**: See `casper/CONTRACTS.md` for addresses

---

## Future Improvements

1. **Liquidation mechanism**: Add liquidator bots and auction system
2. **Multi-validator support**: Distribute delegation across validators
3. **Governance**: Community-controlled parameters
4. **Mainnet deployment**: After thorough security audit
