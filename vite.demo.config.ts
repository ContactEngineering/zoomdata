import { defineConfig, type Connect, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createReadStream, statSync } from 'fs';
import { join, normalize, resolve, sep } from 'path';

/**
 * Serve the pyramids created by demo/make_demo_data.py at /data/, straight
 * from disk: they are too large to bundle, and data created or replaced
 * while the server runs shows up on reload. Single byte ranges are served
 * as the reader of zipped OME-Zarr pyramids requests them, with an ETag.
 */
function serveDemoData(): Plugin {
  const root = resolve(import.meta.dirname, 'demo/data');
  const handler: Connect.NextHandleFunction = (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = join(root, normalize(path));
    let size: number | null = null;
    let etag = '';
    if (file.startsWith(root + sep)) {
      try {
        const stat = statSync(file);
        if (stat.isFile()) {
          size = stat.size;
          etag = `"${stat.size}-${stat.mtimeMs}"`;
        }
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
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    const ifMatch = req.headers['if-match'];
    if (ifMatch && ifMatch !== etag) {
      res.statusCode = 412;
      res.end();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && Number(range[1]) < size) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', size);
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
  root: resolve(import.meta.dirname, 'demo'),
  plugins: [vue(), serveDemoData()],
  server: {
    port: 3000,
    open: true,
  },
  resolve: {
    alias: {
      // The demo imports the library as applications do
      zoomdata: resolve(import.meta.dirname, 'src/index.ts'),
    },
  },
});
