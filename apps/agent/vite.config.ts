import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The PWA and API share an origin in production; the dev proxy keeps
      // the CSP and the absence of a CORS preflight the same in development.
      //
      // Not cookies. This platform sets none, and saying so here matters
      // because this comment is where the claim started: it was quoted into
      // docs/DEPLOYMENT.md and paraphrased twice in apps/api/src/config.ts,
      // each time as a security property somebody might rely on. See *Where
      // the refresh token actually lives* in docs/DEPLOYMENT.md.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    // Surfaced to the backend on every request so government can enforce a
    // minimum supported build (Addendum §43).
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? '1.0.0'),
  },
});
