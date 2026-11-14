import { describe, expect, it } from 'vitest';
import { PyramidGeometry } from './PyramidGeometry';

// 150 x 100 image, 32 pixel tiles: the levels are 150x100, 75x50, 38x25,
// 19x13, 10x7, 5x4, 3x2, 2x1, 1x1 (levels 8 down to 0)
const geometry = new PyramidGeometry({ Width: 150, Height: 100 }, 32, 1);

describe('PyramidGeometry', () => {
  it('has maxLevel = ceil(log2(max(width, height)))', () => {
    expect(geometry.maxLevel).toBe(8);
    expect(new PyramidGeometry({ Width: 256, Height: 1 }, 32, 0).maxLevel).toBe(8);
    expect(new PyramidGeometry({ Width: 1, Height: 1 }, 32, 0).maxLevel).toBe(0);
  });

  it('halves level sizes, rounding up', () => {
    expect(geometry.levelSize(8)).toEqual({ width: 150, height: 100 });
    expect(geometry.levelSize(7)).toEqual({ width: 75, height: 50 });
    expect(geometry.levelSize(6)).toEqual({ width: 38, height: 25 });
    expect(geometry.levelSize(5)).toEqual({ width: 19, height: 13 });
    expect(geometry.levelSize(0)).toEqual({ width: 1, height: 1 });
    expect(geometry.stride(6)).toBe(4);
  });

  it('counts tiles per level', () => {
    expect(geometry.tileCount(8)).toEqual({ cols: 5, rows: 4 });
    expect(geometry.tileCount(7)).toEqual({ cols: 3, rows: 2 });
    expect(geometry.tileCount(5)).toEqual({ cols: 1, rows: 1 });
  });

  it('has the finest single-tile level as base level', () => {
    expect(geometry.baseLevel).toBe(5);
    expect(new PyramidGeometry({ Width: 10, Height: 10 }, 32, 0).baseLevel).toBe(4);
  });

  it('truncates the core of edge tiles', () => {
    expect(geometry.tileCore(8, 4, 3)).toEqual({ x0: 128, y0: 96, x1: 150, y1: 100 });
  });

  it('extends tiles by the overlap where there is data', () => {
    expect(geometry.tileExtent(8, 0, 0)).toEqual({ x0: 0, y0: 0, x1: 33, y1: 33 });
    expect(geometry.tileExtent(8, 1, 1)).toEqual({ x0: 31, y0: 31, x1: 65, y1: 65 });
    expect(geometry.tileExtent(8, 4, 3)).toEqual({ x0: 127, y0: 95, x1: 150, y1: 100 });
    const g0 = new PyramidGeometry({ Width: 150, Height: 100 }, 32, 0);
    expect(g0.tileExtent(8, 1, 1)).toEqual({ x0: 32, y0: 32, x1: 64, y1: 64 });
  });

  it('finds the tile containing a pixel', () => {
    expect(geometry.tileAt(8, 31, 32)).toEqual({ level: 8, col: 0, row: 1 });
  });

  it('lists tiles intersecting an image rectangle', () => {
    // Image pixels [60, 70) at level 7 (stride 2) are level pixels [30, 35)
    expect(geometry.tilesInRect(7, { x0: 60, y0: 0, x1: 70, y1: 10 })).toEqual([
      { level: 7, col: 0, row: 0 },
      { level: 7, col: 1, row: 0 },
    ]);
    expect(geometry.tilesInRect(8, { x0: -100, y0: -100, x1: 1000, y1: 1000 })).toHaveLength(20);
    expect(geometry.tilesInRect(8, { x0: 200, y0: 0, x1: 300, y1: 10 })).toEqual([]);
  });

  it('rejects invalid parameters', () => {
    expect(() => new PyramidGeometry({ Width: 0, Height: 1 }, 32, 0)).toThrow('image size');
    expect(() => new PyramidGeometry({ Width: 1, Height: 1 }, 0, 0)).toThrow('tile size');
    expect(() => new PyramidGeometry({ Width: 1, Height: 1 }, 32, -1)).toThrow('overlap');
  });
});
