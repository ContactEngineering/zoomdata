import { defineConfig } from 'vite';
import { resolve } from 'path';
import pkg from './package.json' with { type: 'json' };

/**
 * Vite configuration for building the library
 * Run with: npm run build
 *
 * Runtime dependencies are not bundled; the application that uses the
 * library installs and bundles them.
 */
const external = Object.keys(pkg.dependencies);

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'ZoomData',
      fileName: 'zoomdata',
    },
    rollupOptions: {
      external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
      output: {
        globals: { zarrita: 'zarr', '@zarrita/storage/zip': 'ZipFileStore' },
      },
    },
  },
});
