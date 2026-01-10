# Repository Guidelines

## Project Structure

Casper-only monorepo for Magni Protocol:

```
magni-casper/
├── casper/
│   ├── magni_casper/     # Odra smart contracts (Rust/WASM)
│   │   ├── src/          # Contract source
│   │   ├── wasm/         # Compiled contracts
│   │   └── Cargo.toml
│   └── frontend/         # React dApp (Vite + TypeScript)
│       ├── src/
│       └── package.json
├── package.json          # Workspace root
└── pnpm-workspace.yaml
```

## Build, Test, and Development

### Contracts (Rust/Odra)

```bash
cd casper/magni_casper

# Run tests
cargo odra test

# Build WASM
cargo odra build

# Deploy to testnet
cargo run --bin magni_livenet --release
```

### Frontend (React)

```bash
cd casper/frontend

pnpm install
pnpm dev      # Development server
pnpm build    # Production build
```

### From root

```bash
pnpm install                 # Install frontend deps
pnpm frontend:dev            # Run frontend dev
pnpm frontend:build          # Build frontend
pnpm contracts:test          # Run contract tests
pnpm contracts:build         # Build contracts
```

## Coding Style

### Rust (Contracts)
- Follow Rust conventions and Odra patterns
- Use `#[odra::module]` for contract modules
- Events via `#[odra::event]`, errors via `OdraError`
- 18 decimals for token amounts (U256)

### TypeScript (Frontend)
- React functional components with hooks
- TypeScript strict mode
- casper-js-sdk for chain interaction
- Environment variables prefixed with `VITE_`

## Commit Guidelines

Follow Conventional Commits:
- `feat(contracts): add liquidation logic`
- `fix(frontend): handle wallet disconnect`
- `chore(repo): update dependencies`
- `docs: update README`

## Environment & Security

- Never commit secrets or private keys
- Use `.env` files (see `.env.example`)
- Contracts: `CASPER_SECRET_KEY` for deployment
- Frontend: `VITE_*_CONTRACT_HASH` for contract addresses
