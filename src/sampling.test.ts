import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDescriptor } from './PyramidDescriptor';
import { PyramidGeometry } from './PyramidGeometry';
import { sampleAt } from './sampling';
import type { Tile } from './Tile';
import { Tile as TileClass } from './Tile';
import { decodeTile } from './TileDecoder';

const FIXTURES = resolve(__dirname, '../test/fixtures');

/** Pyramid fixture with all tiles decoded, plus its reference levels */
function loadPyramid(fixture: string) {
  const descriptor = parseDescriptor(
    JSON.parse(readFileSync(resolve(FIXTURES, fixture, 'dzdata.json'), 'utf8')),
  );
  const geometry = new PyramidGeometry(descriptor.size, descriptor.tileSize, descriptor.overlap);
  const tiles = new Map<string, Tile>();
  for (let level = 0; level <= geometry.maxLevel; level++) {
    const { cols, rows } = geometry.tileCount(level);
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const b = readFileSync(
          resolve(FIXTURES, fixture, `dzdata_files/${level}/${col}_${row}.nc`),
        );
        const decoded = decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
        // A ready tile without going through fetch
        const tile = Object.assign(Object.create(TileClass.prototype), {
          data: decoded.values,
          width: decoded.width,
          height: decoded.height,
          encoding: decoded.encoding ?? descriptor.encoding,
          state: 'ready',
        }) as Tile;
        tiles.set(`${level}/${col}_${row}`, tile);
      }
    }
  }
  const index = JSON.parse(
    readFileSync(resolve(FIXTURES, fixture, 'reference/levels.json'), 'utf8'),
  );
  const raw = readFileSync(resolve(FIXTURES, fixture, 'reference/levels.f64'));
  const reference = (level: number, x: number, y: number) => {
    const { width, offset } = index.levels[level];
    return raw.readDoubleLE(offset + 8 * (y * width + x));
  };
  return { geometry, tiles, reference, scale: descriptor.encoding.scaleFactor };
}

for (const fixture of ['pattern-ov0', 'pattern-ov1', 'pattern-ov2', 'nan-v2']) {
  describe(`sampleAt on ${fixture}`, () => {
    const { geometry, tiles, reference, scale } = loadPyramid(fixture);
    const all = (level: number, col: number, row: number) => tiles.get(`${level}/${col}_${row}`);
    const tol = 1e-7 * scale;

    function expectSample(x: number, y: number, level: number) {
      const s = sampleAt(geometry, all, x, y, level)!;
      const stride = 2 ** (geometry.maxLevel - level);
      expect(s.level).toBe(level);
      expect(s.stride).toBe(stride);
      expect([s.levelX, s.levelY]).toEqual([Math.floor(x / stride), Math.floor(y / stride)]);
      const expected = reference(level, s.levelX, s.levelY);
      if (Number.isNaN(expected)) {
        expect(s.value).toBeNaN();
      } else {
        expect(Math.abs(s.value - expected)).toBeLessThan(tol);
      }
    }

    it('matches the reference at and around every tile border', () => {
      const t = geometry.tileSize;
      for (let level = geometry.maxLevel; level >= geometry.maxLevel - 2; level--) {
        const s = geometry.stride(level);
        const { width, height } = geometry.levelSize(level);
        // Centre of level pixel p; the last block may be truncated
        const cx = (p: number) => Math.min((p + 0.5) * s, geometry.width - 0.01);
        const cy = (p: number) => Math.min((p + 0.5) * s, geometry.height - 0.01);
        for (let b = t; b < Math.max(width, height); b += t) {
          for (const d of [-2, -1, 0, 1]) {
            const p = b + d;
            if (p < width) expectSample(cx(p), 3.5, level);
            if (p < height) expectSample(3.5, cy(p), level);
            if (p < width && p < height) expectSample(cx(p), cy(p), level);
          }
        }
      }
    });

    it('matches the reference at the image edges and corners', () => {
      const { width: w, height: h } = geometry;
      for (let level = geometry.maxLevel; level >= 0; level--) {
        for (const [x, y] of [
          [0, 0],
          [w - 0.01, 0],
          [0, h - 0.01],
          [w - 0.01, h - 0.01],
        ]) {
          expectSample(x, y, level);
        }
      }
    });

    it('matches the reference everywhere on the finest level', () => {
      for (let y = 0; y < geometry.height; y++) {
        for (let x = 0; x < geometry.width; x++) {
          const s = sampleAt(geometry, all, x + 0.5, y + 0.5)!;
          const expected = reference(geometry.maxLevel, x, y);
          if (Number.isNaN(expected)) expect(s.value).toBeNaN();
          else expect(Math.abs(s.value - expected)).toBeLessThan(tol);
        }
      }
    });
  });
}

describe('sampleAt', () => {
  const { geometry, tiles } = loadPyramid('pattern-ov1');

  it('uses the finest level in memory', () => {
    // Only levels up to 6 are in memory
    const lookup = (level: number, col: number, row: number) =>
      level <= 6 ? tiles.get(`${level}/${col}_${row}`) : undefined;
    const s = sampleAt(geometry, lookup, 70.2, 41.9)!;
    expect(s.level).toBe(6);
    expect(s.stride).toBe(4);
    expect([s.levelX, s.levelY, s.imageX0, s.imageY0]).toEqual([17, 10, 68, 40]);
  });

  it('skips tiles that are not ready', () => {
    const lookup = (level: number, col: number, row: number) =>
      level === 8
        ? (Object.create(TileClass.prototype) as Tile)
        : tiles.get(`${level}/${col}_${row}`);
    expect(sampleAt(geometry, lookup, 10, 10)!.level).toBe(7);
  });

  it('returns null outside the image or without tiles', () => {
    const all = (level: number, col: number, row: number) => tiles.get(`${level}/${col}_${row}`);
    expect(sampleAt(geometry, all, -0.1, 5)).toBeNull();
    expect(sampleAt(geometry, all, 150, 5)).toBeNull();
    expect(sampleAt(geometry, all, 5, 100)).toBeNull();
    expect(sampleAt(geometry, () => undefined, 5, 5)).toBeNull();
  });
});
