import { defineConfig, type Connect, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createReadStream, statSync } from 'fs';
import { join, normalize, resolve, sep } from 'path';

/**
 * Serve the pyramids created by demo/make_demo_data.py at /data/, straight
 * from disk: they are too large to bundle, and data created or replaced
 * while the server runs shows up on reload.
 */
function serveDemoData(): Plugin {
  const root = resolve(__dirname, 'demo/data');
  const handler: Connect.NextHandleFunction = (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = join(root, normalize(path));
    let size: number | null = null;
    if (file.startsWith(root + sep)) {
      try {
        const stat = statSync(file);
        if (stat.isFile()) size = stat.size;
      } catch {
        // Not found
      }
    }
    if (size === null) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader(
      'Content-Type',
      file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    );
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'zoomdata-demo-data',
    configureServer: (server) => void server.middlewares.use('/data', handler),
    configurePreviewServer: (server) => void server.middlewares.use('/data', handler),
  };
}

/**
 * Vite configuration for running the demo dev server
 * Run with: npm run dev
 */
export default defineConfig({
  root: resolve(__dirname, 'demo'),
  plugins: [vue(), serveDemoData()],
  server: {
    port: 3000,
    open: true,
  },
  resolve: {
    alias: {
      // The demo imports the library as applications do
      zoomdata: resolve(__dirname, 'src/index.ts'),
    },
  },
});
