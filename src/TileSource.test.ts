import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticTileSource, toTileSource, type TileSource } from './TileSource.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaticTileSource', () => {
  it('appends a trailing slash when missing', () => {
    expect(new StaticTileSource('http://example.com/data').rootUrl).toBe(
      'http://example.com/data/',
    );
  });

  it('builds tile URLs as <level>/<col>_<row>.nc', async () => {
    const source = new StaticTileSource('http://example.com/data/');
    // column 5, row 3 → "5_3.nc"
    expect(await source.tileUrl(12, 5, 3)).toBe('http://example.com/data/dzdata_files/12/5_3.nc');
  });

  it('fetches the descriptor from dzdata.json', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ Image: {} }) });
    vi.stubGlobal('fetch', spy);
    expect(await new StaticTileSource('http://example.com/data/').descriptor()).toEqual({
      Image: {},
    });
    expect(spy).toHaveBeenCalledWith('http://example.com/data/dzdata.json');
  });

  it('reports HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
    );
    await expect(new StaticTileSource('http://example.com/').descriptor()).rejects.toThrow(
      'HTTP 404',
    );
  });
});

describe('toTileSource', () => {
  it('passes a source through', () => {
    const source: TileSource = {
      descriptor: () => Promise.reject(new Error()),
      tileUrl: () => Promise.resolve(null),
    };
    expect(toTileSource(source)).toBe(source);
  });

  it('wraps a string', () => {
    expect(toTileSource('http://example.com/')).toBeInstanceOf(StaticTileSource);
  });
});
