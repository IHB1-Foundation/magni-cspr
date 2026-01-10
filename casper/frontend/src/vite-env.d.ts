/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CASPER_CHAIN_NAME: string
  readonly VITE_CASPER_NODE_URL: string
  readonly VITE_TCSPR_CONTRACT_HASH: string
  readonly VITE_MCSPR_CONTRACT_HASH: string
  readonly VITE_MAGNI_CONTRACT_HASH: string
  readonly VITE_DEFAULT_VALIDATOR_PUBLIC_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
