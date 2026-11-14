import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTile, TileDecodeError } from './TileDecoder.js';

const FIXTURES = resolve(__dirname, '../test/fixtures');

function load(path: string): ArrayBuffer {
  const b = readFileSync(resolve(FIXTURES, path));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Reference level (row-major (y, x), physical units) written by generate.py */
function referenceLevel(fixture: string, level: number) {
  const index = JSON.parse(
    readFileSync(resolve(FIXTURES, fixture, 'reference/levels.json'), 'utf8'),
  );
  const { width, height, offset } = index.levels[level];
  const data = new Float64Array(load(`${fixture}/reference/levels.f64`), offset, width * height);
  return { width, height, data };
}

function descriptor(fixture: string) {
  return JSON.parse(readFileSync(resolve(FIXTURES, fixture, 'dzdata.json'), 'utf8')).Image;
}

describe('decodeTile on pyramids written by SurfaceTopography', () => {
  // Tile (1, 1) of the finest level holds level pixels [31, 65) x [31, 65)
  for (const fixture of ['pattern-ov1', 'nan-v2']) {
    it(`${fixture}: values, layout and coordinates`, () => {
      const image = descriptor(fixture);
      const tile = decodeTile(load(`${fixture}/dzdata_files/8/1_1.nc`), {
        width: 34,
        height: 34,
      });
      expect(tile.width).toBe(34);
      expect(tile.height).toBe(34);
      // The fixtures' heights are in µm, spelled in ASCII
      expect(tile.unit).toBe('um');

      // Version 1 holds (h - min) / (max - min) without attributes, version
      // 2 holds (h - add_offset) / scale_factor with CF attributes
      const enc =
        image.FormatVersion === 2
          ? { scaleFactor: image.Encoding.ScaleFactor, addOffset: image.Encoding.AddOffset }
          : {
              scaleFactor: image.ColorbarRange.Maximum - image.ColorbarRange.Minimum,
              addOffset: image.ColorbarRange.Minimum,
            };
      if (image.FormatVersion === 2) {
        expect(tile.encoding).toEqual(enc);
      } else {
        expect(tile.encoding).toBeNull();
      }

      const ref = referenceLevel(fixture, 8);
      let nan = 0;
      for (let y = 0; y < 34; y++) {
        for (let x = 0; x < 34; x++) {
          const expected = ref.data[(31 + y) * ref.width + 31 + x];
          const h = enc.addOffset + enc.scaleFactor * tile.values[y * 34 + x];
          if (Number.isNaN(expected)) {
            expect(h).toBeNaN();
            nan++;
          } else {
            // float32 storage of a value in [-0.5, 1]
            expect(Math.abs(h - expected)).toBeLessThan(1e-7 * enc.scaleFactor);
          }
        }
      }
      expect(nan > 0).toBe(fixture === 'nan-v2');

      // Pixel size 0.5 µm; the tile starts at level pixel 31
      expect(tile.x![0]).toBeCloseTo(15.5, 12);
      expect(tile.x![33]).toBeCloseTo(32, 12);
      expect(tile.y![0]).toBeCloseTo(15.5, 12);
    });
  }

  it('reads coarse levels', () => {
    // Level 5 is 19 x 13 pixels, a single tile
    const tile = decodeTile(load('pattern-ov1/dzdata_files/5/0_0.nc'));
    expect([tile.width, tile.height]).toEqual([19, 13]);
    const ref = referenceLevel('pattern-ov1', 5);
    const { Minimum: mn, Maximum: mx } = descriptor('pattern-ov1').ColorbarRange;
    for (let i = 0; i < ref.data.length; i++) {
      expect(mn + (mx - mn) * tile.values[i]).toBeCloseTo(ref.data[i], 6);
    }
  });
});

describe('decodeTile variants', () => {
  // These tiles hold h[x, y] = 10 * x + y on a 3 x 2 grid
  const expected = [0, 10, 20, 1, 11, 21];

  it('reads the 64-bit offset variant and CF attributes', () => {
    const tile = decodeTile(load('decoder/offset64.nc'));
    expect([...tile.values]).toEqual(expected);
    expect(tile.encoding).toEqual({ scaleFactor: 2, addOffset: -1 });
    expect(tile.unit).toBeNull();
    expect(tile.x).toBeNull();
  });

  it('reads heights stored as (y, x)', () => {
    const tile = decodeTile(load('decoder/yx.nc'));
    expect([tile.width, tile.height]).toEqual([3, 2]);
    expect([...tile.values]).toEqual(expected);
  });
});

describe('decodeTile errors', () => {
  const cases: [string, () => ArrayBuffer, string][] = [
    ['empty file', () => new ArrayBuffer(0), 'truncated header'],
    [
      'not NetCDF',
      () => new TextEncoder().encode('HDF5 file').buffer as ArrayBuffer,
      'not a NetCDF-3',
    ],
    [
      'CDF-5',
      () => {
        const b = load('decoder/offset64.nc');
        new DataView(b).setUint8(3, 5);
        return b;
      },
      'unsupported NetCDF variant 5',
    ],
    [
      'truncated header',
      () => load('pattern-ov1/dzdata_files/8/1_1.nc').slice(0, 40),
      'truncated header',
    ],
    [
      'truncated data',
      () => {
        const b = load('pattern-ov1/dzdata_files/8/1_1.nc');
        return b.slice(0, b.byteLength - 100);
      },
      'truncated data',
    ],
    ['integer heights', () => load('decoder/int.nc'), 'not float32 or float64'],
    ['unknown dimensions', () => load('decoder/dims.nc'), 'dimensions (a, b)'],
    ['record dimension', () => load('decoder/record.nc'), 'record dimension'],
    ['no heights', () => load('decoder/no-heights.nc'), 'missing variable "heights"'],
  ];
  for (const [name, buffer, message] of cases) {
    it(name, () => {
      expect(() => decodeTile(buffer())).toThrow(TileDecodeError);
      expect(() => decodeTile(buffer())).toThrow(message);
    });
  }

  it('rejects a tile whose shape does not match the geometry', () => {
    expect(() =>
      decodeTile(load('pattern-ov1/dzdata_files/8/1_1.nc'), { width: 33, height: 34 }),
    ).toThrow('shape 34 x 34, expected 33 x 34');
  });
});
