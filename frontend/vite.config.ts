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
    // Listen on all interfaces so a reverse proxy (e.g. `tailscale serve`) can
    // reach the dev server, and accept its forwarded Host header.
    host: true,
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
    },
  },
})
