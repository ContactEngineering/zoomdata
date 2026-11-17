import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './http.js';
import { PyramidGeometry } from './PyramidGeometry.js';
import { ZarrSource } from './ZarrSource.js';

const FIXTURES = resolve(__dirname, '../test/fixtures');

function file(fixture: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, fixture, 'pyramid.ozx')));
}

/** Reference level (row-major (y, x), physical units) written by generate.py */
function referenceLevel(fixture: string, level: number) {
  const index = JSON.parse(
    readFileSync(resolve(FIXTURES, fixture, 'reference/levels.json'), 'utf8'),
  );
  const b = readFileSync(resolve(FIXTURES, fixture, 'reference/levels.f64'));
  const { width, height, offset } = index.levels[level];
  const buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return { width, height, data: new Float64Array(buffer, offset, width * height) };
}

interface Request {
  url: string;
  range: string | null;
  ifMatch: string | null;
}

interface ServerOptions {
  etag?: string | null;
  /** Answer range requests (default: true) */
  ranges?: boolean;
  /** Expose Content-Range (default: true) */
  contentRange?: boolean;
  /** Status to answer a request with instead of the file */
  reject?: (url: string) => number | undefined;
}

/** Serve a file at any URL, with range requests and an ETag */
function serve(bytes: Uint8Array, options: ServerOptions = {}): Request[] {
  const { etag = '"v1"', ranges = true, contentRange = true } = options;
  const log: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const request = { url, range: headers.get('Range'), ifMatch: headers.get('If-Match') };
      log.push(request);
      const status = options.reject?.(url);
      if (status) return new Response(null, { status, statusText: 'Rejected' });
      if (request.ifMatch && request.ifMatch !== etag) {
        return new Response(null, { status: 412, statusText: 'Precondition Failed' });
      }
      const h = new Headers();
      if (etag) h.set('ETag', etag);
      const m = request.range && /^bytes=(\d+)-(\d+)$/.exec(request.range);
      if (!ranges || !m) return new Response(bytes.slice(), { status: 200, headers: h });
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), bytes.length - 1);
      if (contentRange) h.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: h });
    }),
  );
  return log;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ZarrSource', () => {
  it('reads the descriptor from the OME-Zarr and zoomdata attributes', async () => {
    serve(file('pattern-ov1'));
    const d = await new ZarrSource('/pyramid.ozx').descriptor();
    expect(d.format).toBe('zarr');
    expect(d.formatVersion).toBe(1);
    expect(d.size).toEqual({ Width: 150, Height: 100 });
    expect(d.tileSize).toBe(32);
    expect(d.overlap).toBe(1);
    // Levels 8 (150 x 100) down to 5 (19 x 13, a single tile) are stored
    expect(d.minLevel).toBe(5);
    expect(d.unit).toBe('um');
    expect(d.colorbarTitle).toBe('Height (µm)');
    expect(d.downsample).toBe('mean');
    // Pixel size 0.5 µm
    expect(d.pixelsPerMeter!.Width).toBeCloseTo(2e6, 3);
    expect(d.pixelsPerMeter!.Height).toBeCloseTo(2e6, 3);
    const { Minimum, Maximum } = d.colorbarRange!;
    expect(d.encoding.addOffset).toBeCloseTo((Minimum + Maximum) / 2, 12);
    expect(d.encoding.scaleFactor).toBeCloseTo(Maximum - Minimum, 12);
  });

  for (const [fixture, overlap] of [
    ['pattern-ov1', 1],
    ['pattern-ov1', 0],
    ['pattern-ov1', 2],
    ['nan-v2', 1],
  ] as const) {
    it(`${fixture}, overlap ${overlap}: tiles hold the reference levels`, async () => {
      serve(file(fixture));
      const source = new ZarrSource('/pyramid.ozx', { overlap, prefixBytes: 1024 });
      const d = await source.descriptor();
      const geometry = new PyramidGeometry(d.size, d.tileSize, d.overlap, d.minLevel);
      const span = d.colorbarRange!.Maximum - d.colorbarRange!.Minimum;
      for (let level = d.minLevel; level <= geometry.maxLevel; level++) {
        const ref = referenceLevel(fixture, level);
        const { cols, rows } = geometry.tileCount(level);
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const tile = await source.readTile(level, col, row);
            const e = geometry.tileExtent(level, col, row);
            expect([tile.width, tile.height]).toEqual([e.x1 - e.x0, e.y1 - e.y0]);
            const { addOffset, scaleFactor } = tile.encoding!;
            for (let y = 0; y < tile.height; y++) {
              for (let x = 0; x < tile.width; x++) {
                const expected = ref.data[(e.y0 + y) * ref.width + e.x0 + x];
                const actual = addOffset + scaleFactor * tile.values[y * tile.width + x];
                if (Number.isNaN(expected)) {
                  expect(actual).toBeNaN();
                } else {
                  expect(Math.abs(actual - expected)).toBeLessThan(1e-6 * span);
                }
              }
            }
          }
        }
      }
    });
  }

  it('fetches the metadata at once and every chunk once', async () => {
    const log = serve(file('noise-zarr'));
    const source = new ZarrSource('/pyramid.ozx');
    await source.descriptor();
    // Size and metadata, then the end with the central directory
    expect(log.map((r) => r.range)).toEqual(['bytes=0-65535', expect.stringMatching(/^bytes=/)]);
    expect(log[1].range).toMatch(new RegExp(`-${file('noise-zarr').length - 1}$`));
    // All tiles of the finest level: neighbouring tiles share chunks
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 7; col++) await source.readTile(8, col, row);
    }
    expect(log.length).toBeGreaterThan(2);
    const ranges = log.slice(2).map((r) => r.range);
    expect(new Set(ranges).size).toBe(ranges.length);
    // Later requests are tied to the version of the file
    expect(log.slice(1).every((r) => r.ifMatch === '"v1"')).toBe(true);
  });

  it('reads tiles below the coarsest stored level as an error', async () => {
    serve(file('pattern-ov1'));
    const source = new ZarrSource('/pyramid.ozx');
    await expect(source.readTile(4, 0, 0)).rejects.toThrow('Level 4 is not stored');
  });

  it('works with a server that ignores ranges', async () => {
    serve(file('pattern-ov1'), { ranges: false, etag: null });
    const source = new ZarrSource('/pyramid.ozx', { prefixBytes: 1024 });
    const tile = await source.readTile(8, 1, 1);
    expect([tile.width, tile.height]).toEqual([34, 34]);
  });

  it('explains a missing Content-Range header', async () => {
    serve(file('pattern-ov1'), { contentRange: false });
    await expect(
      new ZarrSource('/pyramid.ozx', { prefixBytes: 1024 }).descriptor(),
    ).rejects.toThrow('expose the Content-Range header');
  });

  it('fails if the file changed on the server', async () => {
    const bytes = file('noise-zarr');
    serve(bytes);
    const source = new ZarrSource('/pyramid.ozx', { prefixBytes: 1024 });
    await source.descriptor();
    serve(bytes, { etag: '"v2"' });
    await expect(source.readTile(8, 0, 0)).rejects.toThrow('changed on the server');
  });

  it('throws HTTP errors and replaces an expired URL on invalidate', async () => {
    // The URL source hands out the same URL until it is invalidated; the
    // server accepts only the newest signature
    let valid = 1;
    let issued = 1;
    const urls = {
      url: vi.fn(async () => `/pyramid.ozx?sig=${issued}`),
      invalidate: vi.fn(() => (issued = valid)),
    };
    serve(file('noise-zarr'), {
      reject: (url) => (url.endsWith(`sig=${valid}`) ? undefined : 403),
    });
    const source = new ZarrSource(urls, { prefixBytes: 1024 });
    await source.descriptor();
    valid = 2; // the URL expires
    const error = await source.readTile(8, 0, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(403);
    source.invalidate();
    expect(urls.invalidate).toHaveBeenCalledOnce();
    await expect(source.readTile(8, 0, 0)).resolves.toMatchObject({ width: 33, height: 33 });
  });

  it('opens again after a failed open', async () => {
    serve(file('pattern-ov1'), { reject: () => 503 });
    const source = new ZarrSource('/pyramid.ozx');
    await expect(source.descriptor()).rejects.toBeInstanceOf(HttpError);
    serve(file('pattern-ov1'));
    await expect(source.descriptor()).resolves.toMatchObject({ format: 'zarr' });
  });

  it('rejects a file that is not a zoomdata pyramid', async () => {
    serve(new Uint8Array(100));
    await expect(new ZarrSource('/pyramid.ozx').descriptor()).rejects.toThrow();
  });

  it('rejects an invalid overlap', () => {
    expect(() => new ZarrSource('/pyramid.ozx', { overlap: -1 })).toThrow('Invalid overlap');
  });
});
