import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fixed dev port (5173, Vite's default) so electron/src/main.ts can point a
// BrowserWindow at it without discovering it dynamically. /api is proxied to
// the embedded server, which Electron also launches on a fixed dev port —
// see electron/src/main.ts and PLAN.md "Desktop shell" ("in dev, at the Vite
// dev server URL with the API proxied to the embedded server").
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4174',
    },
  },
});
