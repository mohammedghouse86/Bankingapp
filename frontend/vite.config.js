import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) together with hash-based routing.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, host: 'localhost' },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
