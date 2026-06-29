import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../src/teamwork/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Secure-by-default: bind loopback only. A reverse proxy on the same host
    // (e.g. `tailscale serve`, which dials localhost) still reaches it, so the
    // dev server isn't exposed on the network. Set VITE_BIND_ALL=1 to listen on
    // all interfaces — only when something else owns the boundary (a proxy on a
    // different host, or direct tailnet-IP access). See the network-exposure doc.
    host: process.env.VITE_BIND_ALL ? true : '127.0.0.1',
    // Accept a reverse proxy's forwarded Host header regardless of bind.
    allowedHosts: true,
    // When served through an HTTPS reverse proxy (tailscale), the browser's HMR
    // client must connect back over wss on 443 (the public origin), not the dev
    // server's bare :5173. Gated on TEAMWORK_TAILSCALE so plain local
    // `npm run dev` keeps Vite's normal same-port HMR.
    ...(process.env.TEAMWORK_TAILSCALE
      ? { hmr: { protocol: 'wss', clientPort: 443 } }
      : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      // Public, backend-served content (Prax Hugo static, proxied via the
      // TeamWork backend's content router). These live at the root — NOT under
      // /api — so without proxying them Vite serves the SPA shell for
      // /notes/<slug>/ etc. and the page renders blank in dev. Hugo emits
      // relativeURLs, so each tree's assets resolve under its own prefix.
      ...Object.fromEntries(
        ['/notes', '/courses', '/news'].map((p) => [
          p,
          { target: 'http://localhost:8000', changeOrigin: true },
        ]),
      ),
    },
  },
})
