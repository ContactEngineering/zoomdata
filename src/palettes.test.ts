import { describe, expect, it } from 'vitest';
import { grayscale, inferno, magma, Palettes, plasma, viridis } from './palettes.js';

/** RGBA of a palette entry (0xAABBGGRR) */
function rgba(color: number): [number, number, number, number] {
  return [color & 0xff, (color >>> 8) & 0xff, (color >>> 16) & 0xff, (color >>> 24) & 0xff];
}

// Entries 0, 64, 128, 192 and 255 of matplotlib's 256-entry colour maps,
// round(255 * value), from matplotlib 3.11
const MATPLOTLIB = {
  inferno: [
    [0, 0, 4],
    [87, 16, 110],
    [188, 55, 84],
    [249, 142, 9],
    [252, 255, 164],
  ],
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  magma: [
    [0, 0, 4],
    [81, 18, 124],
    [183, 55, 121],
    [252, 137, 97],
    [252, 253, 191],
  ],
  plasma: [
    [13, 8, 135],
    [126, 3, 168],
    [204, 71, 120],
    [248, 149, 64],
    [240, 249, 33],
  ],
};
const CHECKPOINTS = [0, 64, 128, 192, 255];

describe('palettes', () => {
  for (const [name, colors] of Object.entries(MATPLOTLIB)) {
    const palette = Palettes[name as keyof typeof MATPLOTLIB];

    it(`${name} has 256 opaque entries that match matplotlib`, () => {
      const p = palette();
      expect(p).toHaveLength(256);
      CHECKPOINTS.forEach((i, j) => expect(rgba(p[i])).toEqual([...colors[j], 255]));
      expect(p.every((c) => rgba(c)[3] === 255)).toBe(true);
    });

    it(`${name} resampled to n entries keeps both ends and the order`, () => {
      const full = palette(256);
      for (const n of [2, 7, 64, 1000]) {
        const p = palette(n);
        expect(p).toHaveLength(n);
        expect(p[0]).toBe(full[0]);
        expect(p[n - 1]).toBe(full[255]);
        // Every entry is one of the full palette's, in increasing order
        const indices = p.map((c) => full.indexOf(c));
        expect(indices.every((i, k) => i >= 0 && (k === 0 || i >= indices[k - 1]))).toBe(true);
      }
    });
  }

  it('returns copies that callers may modify', () => {
    const a = inferno();
    a[0] = 0;
    expect(inferno()[0]).not.toBe(0);
  });

  it('rejects an empty palette', () => {
    for (const p of [inferno, viridis, magma, plasma]) {
      expect(() => p(0)).toThrow('must be positive');
    }
  });

  it('grayscale runs from black to white in equal steps', () => {
    expect(grayscale(3).map(rgba)).toEqual([
      [0, 0, 0, 255],
      [128, 128, 128, 255],
      [255, 255, 255, 255],
    ]);
    const g = grayscale().map((c) => rgba(c)[0]);
    expect(g).toHaveLength(256);
    expect(g.every((v, i) => v === i)).toBe(true);
  });
});
