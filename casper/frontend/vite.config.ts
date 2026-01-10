import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const nodeUrlRaw = env.VITE_CASPER_NODE_URL || 'https://node.testnet.casper.network/rpc'
  const proxyTarget = nodeUrlRaw.endsWith('/rpc') ? nodeUrlRaw.slice(0, -4) : nodeUrlRaw

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        // Casper nodes typically don't send CORS headers. In dev, proxy through Vite to make
        // browser requests work (balance queries, putDeploy, etc.).
        '/rpc': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy: {
        '/rpc': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    define: {
      // Polyfill for casper-js-sdk
      global: 'globalThis',
    },
    resolve: {
      alias: {
        // Node.js polyfills for casper-js-sdk
        buffer: 'buffer',
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
      },
      include: ['buffer'],
    },
  }
})
