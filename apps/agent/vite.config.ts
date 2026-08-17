import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The PWA and API share an origin in production; the dev proxy keeps
      // cookies, CSP and CORS behaviour the same in development.
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
