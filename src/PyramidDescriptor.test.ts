import { describe, expect, it } from 'vitest';
import { parseDescriptor } from './PyramidDescriptor';
import type { DZIMetadata } from './types';

const BASE = {
  Size: { Width: 150, Height: 100 },
  TileSize: 32,
  Overlap: 1,
  ColorbarRange: { Minimum: -2, Maximum: 6 },
};

function parse(image: object) {
  return parseDescriptor({ Image: image } as DZIMetadata);
}

describe('parseDescriptor', () => {
  it('treats a descriptor without FormatVersion as version 1', () => {
    const d = parse(BASE);
    expect(d.formatVersion).toBe(1);
    // Version 1 tiles hold (h - min) / (max - min)
    expect(d.encoding).toEqual({ scaleFactor: 8, addOffset: -2 });
  });

  it('gives a flat version 1 map scale 1', () => {
    const d = parse({ ...BASE, ColorbarRange: { Minimum: 3, Maximum: 3 } });
    expect(d.encoding).toEqual({ scaleFactor: 1, addOffset: 3 });
  });

  it('reads the encoding of version 2', () => {
    const d = parse({
      ...BASE,
      FormatVersion: 2,
      Encoding: { ScaleFactor: 8, AddOffset: 2 },
      Unit: 'µm',
      Detrend: 'curvature',
      Downsample: 'mean',
    });
    expect(d.formatVersion).toBe(2);
    expect(d.encoding).toEqual({ scaleFactor: 8, addOffset: 2 });
    expect([d.unit, d.detrend, d.downsample]).toEqual(['µm', 'curvature', 'mean']);
  });

  it('requires the encoding for version 2', () => {
    expect(() => parse({ ...BASE, FormatVersion: 2 })).toThrow('requires "Image.Encoding"');
  });

  it('rejects unknown versions and formats', () => {
    expect(() => parse({ ...BASE, FormatVersion: 3 })).toThrow('unsupported format version 3');
    expect(() => parse({ ...BASE, Format: 'jpg' })).toThrow('unsupported tile format "jpg"');
  });

  it('accepts any non-negative overlap and defaults it to 0', () => {
    expect(parse({ ...BASE, Overlap: undefined }).overlap).toBe(0);
    expect(parse({ ...BASE, Overlap: 3 }).overlap).toBe(3);
    expect(() => parse({ ...BASE, Overlap: -1 })).toThrow('Overlap');
  });
});
