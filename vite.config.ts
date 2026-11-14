import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Vite configuration for building the library
 * Run with: npm run build
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'ZoomData',
      fileName: 'zoomdata',
    },
  },
});
