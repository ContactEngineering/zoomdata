import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tile } from './Tile';
import { TileState } from './types';

// 3 x 2 tile holding h[x, y] = 10 * x + y, scale_factor 2, add_offset -1
const TILE = readFileSync(resolve(__dirname, '../test/fixtures/decoder/offset64.nc'));
const URL = 'http://example.com/tile.nc';

const fetchMock = vi.fn();

function respond(ok = true, status = 200, body: Uint8Array = TILE): void {
  fetchMock.mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    arrayBuffer: () =>
      Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  respond();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('Tile', () => {
  describe('initial state', () => {
    it('starts in Pending state without data or error', () => {
      const tile = new Tile(URL);
      expect(tile.getState()).toBe(TileState.Pending);
      expect(tile.isReady()).toBe(false);
      expect(tile.getData()).toBeNull();
      expect(tile.getError()).toBeNull();
    });
  });

  describe('successful fetch', () => {
    it('decodes the tile row-major (y, x)', async () => {
      const tile = new Tile(URL);
      await tile.fetch();
      expect(tile.getState()).toBe(TileState.Ready);
      expect(tile.isReady()).toBe(true);
      expect([tile.width, tile.height]).toEqual([3, 2]);
      expect([...tile.getData()!]).toEqual([0, 10, 20, 1, 11, 21]);
      expect(tile.getError()).toBeNull();
    });

    it('returns physical values using the tile encoding', async () => {
      const tile = new Tile(URL);
      await tile.fetch();
      expect(tile.getEncoding()).toEqual({ scaleFactor: 2, addOffset: -1 });
      expect(tile.valueAt(2, 1)).toBe(-1 + 2 * 21);
    });

    it('resolves the URL lazily', async () => {
      const resolveUrl = vi.fn().mockResolvedValue(URL);
      const tile = new Tile(resolveUrl);
      expect(resolveUrl).not.toHaveBeenCalled();
      await tile.fetch();
      expect(fetchMock).toHaveBeenCalledWith(URL);
    });

    it('deduplicates concurrent fetches', async () => {
      const tile = new Tile(URL);
      await Promise.all([tile.fetch(), tile.fetch()]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not refetch a ready tile', async () => {
      const tile = new Tile(URL);
      await tile.fetch();
      await tile.fetch();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('failures', () => {
    it('reports HTTP errors', async () => {
      respond(false, 404);
      const tile = new Tile(URL);
      await expect(tile.fetch()).rejects.toThrow('HTTP 404');
      expect(tile.getState()).toBe(TileState.Error);
      expect(tile.getError()?.message).toContain('HTTP 404');
    });

    it('reports a missing tile', async () => {
      await expect(new Tile(() => Promise.resolve(null)).fetch()).rejects.toThrow('not available');
    });

    it('rejects a tile of unexpected shape', async () => {
      const tile = new Tile(URL, { expectedShape: { width: 2, height: 3 } });
      await expect(tile.fetch()).rejects.toThrow('expected 2 x 3');
    });

    it('can be retried after an error', async () => {
      respond(false, 500);
      const tile = new Tile(URL);
      await expect(tile.fetch()).rejects.toThrow();
      respond();
      await tile.fetch();
      expect(tile.isReady()).toBe(true);
    });
  });

  describe('clearCache()', () => {
    it('drops data and returns to Pending', async () => {
      const tile = new Tile(URL);
      await tile.fetch();
      tile.clearCache();
      expect(tile.getData()).toBeNull();
      expect(tile.getState()).toBe(TileState.Pending);
    });
  });
});
