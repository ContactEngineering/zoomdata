import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tile } from './Tile';
import { TileState } from './types';
import { NetCDFReader } from 'netcdfjs';

vi.mock('netcdfjs', () => ({
  NetCDFReader: vi.fn(),
}));

const fetchMock = vi.fn();

function setupSuccessfulNetCDF(data: number[], rows: number, cols: number): void {
  vi.mocked(NetCDFReader).mockImplementation(function () {
    return {
      getDataVariable: () => data,
      variables: [{ name: 'heights', dimensions: [0, 1] }],
      dimensions: [{ name: 'row', size: rows }, { name: 'col', size: cols }],
    };
  } as unknown as () => NetCDFReader);
}

function setupSuccessfulFetch(): void {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
}

function setupFailedFetch(status: number): void {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  setupSuccessfulFetch();
  setupSuccessfulNetCDF([1.0, 2.0, 3.0, 4.0], 2, 2);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.mocked(NetCDFReader).mockReset();
});

describe('Tile', () => {
  describe('initial state', () => {
    it('starts in Pending state', () => {
      expect(new Tile('http://example.com/tile.nc').getState()).toBe(TileState.Pending);
    });

    it('is not ready before fetch', () => {
      expect(new Tile('http://example.com/tile.nc').isReady()).toBe(false);
    });

    it('has no data before fetch', () => {
      expect(new Tile('http://example.com/tile.nc').getData()).toBeNull();
    });

    it('has no error before fetch', () => {
      expect(new Tile('http://example.com/tile.nc').getError()).toBeNull();
    });
  });

  describe('successful fetch', () => {
    it('transitions to Ready state', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      expect(tile.getState()).toBe(TileState.Ready);
    });

    it('isReady() returns true', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      expect(tile.isReady()).toBe(true);
    });

    it('populates data as Float32Array with the correct values', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      expect(tile.getData()).toBeInstanceOf(Float32Array);
      expect(tile.getData()).toEqual(new Float32Array([1.0, 2.0, 3.0, 4.0]));
    });

    it('sets width from the second NetCDF dimension (columns)', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      expect(tile.width).toBe(2);
    });

    it('sets height from the first NetCDF dimension (rows)', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      expect(tile.height).toBe(2);
    });

    it('has no error after successful fetch', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      expect(tile.getError()).toBeNull();
    });
  });

  describe('fetch deduplication', () => {
    it('issues only one network request for concurrent calls', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await Promise.all([tile.fetch(), tile.fetch(), tile.fetch()]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when called again after a successful load', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      const callsBefore = fetchMock.mock.calls.length;
      await tile.fetch();
      expect(fetchMock).toHaveBeenCalledTimes(callsBefore);
    });
  });

  describe('error handling', () => {
    it('transitions to Error state on HTTP failure', async () => {
      setupFailedFetch(404);
      const tile = new Tile('http://example.com/tile.nc');
      await expect(tile.fetch()).rejects.toThrow('HTTP 404');
      expect(tile.getState()).toBe(TileState.Error);
    });

    it('stores the error for inspection via getError()', async () => {
      setupFailedFetch(500);
      const tile = new Tile('http://example.com/tile.nc');
      await expect(tile.fetch()).rejects.toThrow();
      expect(tile.getError()).toBeInstanceOf(Error);
    });

    it('isReady() returns false after an error', async () => {
      setupFailedFetch(404);
      const tile = new Tile('http://example.com/tile.nc');
      await expect(tile.fetch()).rejects.toThrow();
      expect(tile.isReady()).toBe(false);
    });

    it('throws when the heights variable is absent from the NetCDF file', async () => {
      vi.mocked(NetCDFReader).mockImplementation(function () {
        return { getDataVariable: () => null, variables: [], dimensions: [] };
      } as unknown as () => NetCDFReader);
      await expect(new Tile('http://example.com/tile.nc').fetch()).rejects.toThrow(
        'missing "heights" variable'
      );
    });

    it('throws when the heights variable metadata is absent', async () => {
      vi.mocked(NetCDFReader).mockImplementation(function () {
        return {
          getDataVariable: () => [1.0],
          variables: [], // no 'heights' entry
          dimensions: [{ name: 'x', size: 1 }],
        };
      } as unknown as () => NetCDFReader);
      await expect(new Tile('http://example.com/tile.nc').fetch()).rejects.toThrow(
        'missing "heights" variable metadata'
      );
    });

    it('throws when the heights variable is not 2D', async () => {
      vi.mocked(NetCDFReader).mockImplementation(function () {
        return {
          getDataVariable: () => [1.0, 2.0, 3.0],
          variables: [{ name: 'heights', dimensions: [0] }], // 1D
          dimensions: [{ name: 'x', size: 3 }],
        };
      } as unknown as () => NetCDFReader);
      await expect(new Tile('http://example.com/tile.nc').fetch()).rejects.toThrow(
        'Expected 2D heights variable'
      );
    });
  });

  describe('retry after error', () => {
    it('allows a successful retry after a previous fetch failure', async () => {
      setupFailedFetch(503);
      const tile = new Tile('http://example.com/tile.nc');
      await expect(tile.fetch()).rejects.toThrow();
      expect(tile.getState()).toBe(TileState.Error);

      setupSuccessfulFetch();
      setupSuccessfulNetCDF([1.0, 2.0, 3.0, 4.0], 2, 2);
      await tile.fetch();
      expect(tile.getState()).toBe(TileState.Ready);
    });
  });

  describe('clearCache()', () => {
    it('resets a Ready tile to Pending', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      tile.clearCache();
      expect(tile.getState()).toBe(TileState.Pending);
    });

    it('clears the data', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      tile.clearCache();
      expect(tile.getData()).toBeNull();
    });

    it('resets state to Pending even when called during Loading', () => {
      const tile = new Tile('http://example.com/tile.nc');
      tile.fetch(); // start without awaiting; state is set to Loading synchronously
      expect(tile.getState()).toBe(TileState.Loading);
      tile.clearCache();
      expect(tile.getState()).toBe(TileState.Pending);
    });

    it('allows a fresh fetch after clearing a Ready tile', async () => {
      const tile = new Tile('http://example.com/tile.nc');
      await tile.fetch();
      tile.clearCache();
      await tile.fetch();
      expect(tile.getState()).toBe(TileState.Ready);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
