# Casper Testnet Contract Deployments

This file tracks deployed contract addresses on Casper Testnet.

## Current Deployment (2026-01-11)

| Contract | Package Hash |
|----------|--------------|
| **Magni** (V2 Vault) | `50ba0aecbec54ade57fe1ae840d6b1d689d606f745a008c1d5b60140786de323` |
| **mCSPR** (Debt Token) | `f659a6469d8038cb5e856be186ec601f353021eb475828e1f0cebce6d6a3685e` |
| **Validator** | `012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80` |

- **Network**: casper-test
- **Node RPC**: https://node.testnet.casper.network

### Explorer Links

- Magni: https://testnet.cspr.live/contract-package/50ba0aecbec54ade57fe1ae840d6b1d689d606f745a008c1d5b60140786de323
- mCSPR: https://testnet.cspr.live/contract-package/f659a6469d8038cb5e856be186ec601f353021eb475828e1f0cebce6d6a3685e

---

## How to Deploy

```bash
# 1. Configure environment
cp casper/.env.example casper/.env
# Edit casper/.env with your secret key path and settings

# 2. Run all-in-one deploy + frontend wiring
bash casper/scripts/testnet_deploy_and_wire_frontend.sh
```

The deploy script automatically updates:
- `casper/frontend/.env.local` - Environment variables for frontend
- `casper/frontend/src/config/contracts.generated.ts` - TypeScript constants

---

## Deployment History

### 2026-01-11T00:12:27Z

| Contract | Package Hash |
|----------|--------------|
| Magni | `3af8e70c20b5721b1ca37d5721f7ce336f4405cfef52c99025b021593e63ef1e` |
| mCSPR | `c7372edd6aaaf6a0b37a115e9d3e0ee2f6010f6eacc3f0e83becb00d6bb74e66` |

### 2026-01-10T22:54:10Z

| Contract | Package Hash |
|----------|--------------|
| Magni | `7b56884aebc6e9cb3cc495f42cfc99a56be73b96c32fadf9931c0f205a29ef5f` |
| mCSPR | `e8fa988e89d6c7d1abac54de32e61bca28ac9bedc689f556d8256bf6e14dfbd4` |

### 2026-01-10T09:15:29Z

| Contract | Package Hash |
|----------|--------------|
| Magni | `84457f7cc823c97a1443cc95e5826fba4a0c41f5ff150279f5414778da2fa3ba` |
| mCSPR | `345ef050546b07564f2e4cd33aa7b1a2f6f798f53ff9cd807f1fa407a1507f02` |

### 2026-01-10T07:18Z (Partial - Magni failed)

| Contract | Package Hash |
|----------|--------------|
| tCSPR | `12f11f19956442b708884ce6573c1ae84399f3de2827be07fb5763239267be2d` |
| mCSPR | `1fcde96b464c9312f1ca2c11e3120d13cb2caeced83879ec5c0dca4acd1f21e9` |

Note: Magni deployment failed due to insufficient available funds (Casper 2.0 gas-hold).
