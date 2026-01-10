# Casper Testnet Contract Deployments

This file tracks deployed contract addresses on Casper Testnet.

## How to Deploy

```bash
# (권장) casper/.env로 관리
cp casper/.env.example casper/.env
# edit casper/.env

# (선택) 직접 export 하고 싶다면:
# export ODRA_CASPER_LIVENET_SECRET_KEY_PATH=/path/to/secret_key.pem
# export ODRA_CASPER_LIVENET_NODE_ADDRESS=https://node.testnet.casper.network   # no /rpc (Odra appends /rpc)
# export ODRA_CASPER_LIVENET_EVENTS_URL=https://node.testnet.casper.network/events
# export ODRA_CASPER_LIVENET_CHAIN_NAME=casper-test

# Run all-in-one deploy + frontend wiring
bash casper/scripts/testnet_deploy_and_wire_frontend.sh
```

## Contract Addresses

The deploy script automatically updates:
- `casper/frontend/.env.local` - Environment variables for frontend
- `casper/frontend/src/config/contracts.generated.ts` - TypeScript constants

---

<!-- Deployment entries will be appended below by the deploy script -->

## Deployment (tokens only): 2026-01-10T07:18Z

Note: This run successfully deployed token contracts, but the Magni deployment failed due to insufficient available funds (Casper 2.0 gas-hold can lock the full payment limit for a period).

| Field | Value |
|-------|-------|
| Network | casper-test |
| Node RPC (base) | https://node.testnet.casper.network |
| tCSPR (package hash) | `12f11f19956442b708884ce6573c1ae84399f3de2827be07fb5763239267be2d` |
| mCSPR (package hash) | `1fcde96b464c9312f1ca2c11e3120d13cb2caeced83879ec5c0dca4acd1f21e9` |
| Magni | not deployed |
| Tx (tCSPR) | `4cfac9683d28bad7eea4a2ff0776c192717a2a5065caa2371d8cdce7f4c71ca3` |
| Tx (mCSPR) | `01f4534ee1934bdfc2dd711fca4e8980b933dd3fbc8190cd438f5ddbc78df27a` |
| Tx (Magni failed) | `dad8444b6aabbf0c13b6b9355c55603940215556f6082cde4d8033724ac96c34` |

## Deployment: 2026-01-10T09:15:29Z

| Field | Value |
|-------|-------|
| Network | casper-test |
| Node RPC | https://node.testnet.casper.network |
| mCSPR | `Contract(ContractPackageHash(345ef050546b07564f2e4cd33aa7b1a2f6f798f53ff9cd807f1fa407a1507f02))` |
| Magni | `Contract(ContractPackageHash(84457f7cc823c97a1443cc95e5826fba4a0c41f5ff150279f5414778da2fa3ba))` |
| Validator | `012b365e09c5d75187b4abc25c4aa28109133bab6a256ef4abe24348073e590d80` |

---
