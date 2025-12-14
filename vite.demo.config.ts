import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Vite configuration for running the demo dev server
 * Run with: npm run dev
 */
export default defineConfig({
  root: resolve(__dirname, 'demo'),
  server: {
    port: 3000,
    open: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
