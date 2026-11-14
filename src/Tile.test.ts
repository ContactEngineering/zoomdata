import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Tile } from './Tile.js';
import { TileState } from './types.js';

// 3 x 2 tile holding h[x, y] = 10 * x + y, scale_factor 2, add_offset -1
const b = readFileSync(resolve(__dirname, '../test/fixtures/decoder/offset64.nc'));
const TILE = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('Tile', () => {
  it('starts in Pending state without data or error', () => {
    const tile = new Tile();
    expect(tile.getState()).toBe(TileState.Pending);
    expect(tile.isReady()).toBe(false);
    expect(tile.getData()).toBeNull();
    expect(tile.getError()).toBeNull();
    expect(tile.byteSize()).toBe(0);
  });

  it('decodes a tile row-major (y, x)', () => {
    const tile = new Tile();
    tile.load(TILE);
    expect(tile.getState()).toBe(TileState.Ready);
    expect(tile.isReady()).toBe(true);
    expect([tile.width, tile.height]).toEqual([3, 2]);
    expect([...tile.getData()!]).toEqual([0, 10, 20, 1, 11, 21]);
    expect(tile.byteSize()).toBe(24);
  });

  it('returns physical values using the tile encoding', () => {
    const tile = new Tile({ encoding: { scaleFactor: 5, addOffset: 5 } });
    tile.load(TILE);
    // The tile's own CF attributes take precedence
    expect(tile.getEncoding()).toEqual({ scaleFactor: 2, addOffset: -1 });
    expect(tile.valueAt(2, 1)).toBe(-1 + 2 * 21);
  });

  it('rejects a tile of unexpected shape', () => {
    const tile = new Tile({ expectedShape: { width: 2, height: 3 } });
    expect(() => tile.load(TILE)).toThrow('expected 2 x 3');
    expect(tile.getState()).toBe(TileState.Error);
    expect(tile.getError()?.message).toContain('expected 2 x 3');
  });

  it('records failures and can be reset to Pending', () => {
    const tile = new Tile();
    tile.fail(new Error('HTTP 500'));
    expect(tile.getState()).toBe(TileState.Error);
    tile.setState(TileState.Pending);
    expect(tile.getState()).toBe(TileState.Pending);
    expect(tile.getError()).toBeNull();
  });

  it('clearCache() drops data and returns to Pending', () => {
    const tile = new Tile();
    tile.load(TILE);
    tile.clearCache();
    expect(tile.getData()).toBeNull();
    expect(tile.byteSize()).toBe(0);
    expect(tile.getState()).toBe(TileState.Pending);
  });
});
