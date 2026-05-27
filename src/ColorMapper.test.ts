import { describe, it, expect } from 'vitest';
import { ColorMapper } from './ColorMapper';

// Simple two-color palette: red (0xRRGGBBAA) and blue, stored as little-endian uint32.
// In the DataView.setUint32 call (little-endian), 0xAABBGGRR maps to bytes [RR, GG, BB, AA].
// palette[0] = 0xFF0000FF → bytes [0xFF, 0x00, 0x00, 0xFF] (red, full alpha)
// palette[1] = 0x0000FFFF → bytes [0xFF, 0xFF, 0x00, 0x00] (blue, full alpha)
const RED_BLUE_PALETTE = [0xff0000ff, 0x0000ffff];

// Checks whether the test environment's OffscreenCanvas supports real pixel round-trips.
// happy-dom stubs canvas but doesn't do actual pixel rendering, so we skip
// pixel-level assertions there and leave them for real browser / Playwright tests.
function canvasSupportsPixelReadback(): boolean {
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const img = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    ctx.putImageData(img, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[0] === 255;
  } catch {
    return false;
  }
}

const pixelReadbackAvailable = canvasSupportsPixelReadback();

describe('ColorMapper', () => {
  describe('constructor validation', () => {
    it('throws for an empty palette', () => {
      expect(() => new ColorMapper([], 0, 1)).toThrow('colorPalette must not be empty');
    });

    it('throws when minValue equals maxValue', () => {
      expect(() => new ColorMapper(RED_BLUE_PALETTE, 5, 5)).toThrow(
        'minValue must be less than maxValue',
      );
    });

    it('throws when minValue is greater than maxValue', () => {
      expect(() => new ColorMapper(RED_BLUE_PALETTE, 10, 5)).toThrow(
        'minValue must be less than maxValue',
      );
    });

    it('accepts negative value ranges', () => {
      expect(() => new ColorMapper(RED_BLUE_PALETTE, -100, -1)).not.toThrow();
    });

    it('accepts a single-entry palette', () => {
      expect(() => new ColorMapper([0xff0000ff], 0, 1)).not.toThrow();
    });
  });

  describe('getMinValue() and getMaxValue()', () => {
    it('returns the values passed to the constructor', () => {
      const cm = new ColorMapper(RED_BLUE_PALETTE, -10, 50);
      expect(cm.getMinValue()).toBe(-10);
      expect(cm.getMaxValue()).toBe(50);
    });
  });

  describe('withRange()', () => {
    it('returns a new ColorMapper instance', () => {
      const original = new ColorMapper(RED_BLUE_PALETTE, 0, 1);
      const updated = original.withRange(5, 10);
      expect(updated).not.toBe(original);
    });

    it('new instance has the updated range', () => {
      const updated = new ColorMapper(RED_BLUE_PALETTE, 0, 1).withRange(5, 10);
      expect(updated.getMinValue()).toBe(5);
      expect(updated.getMaxValue()).toBe(10);
    });

    it('does not mutate the original', () => {
      const original = new ColorMapper(RED_BLUE_PALETTE, 0, 1);
      original.withRange(5, 10);
      expect(original.getMinValue()).toBe(0);
      expect(original.getMaxValue()).toBe(1);
    });
  });

  describe('render()', () => {
    it('throws when data length does not match width * height', () => {
      const cm = new ColorMapper(RED_BLUE_PALETTE, 0, 1);
      expect(() => cm.render(new Float32Array([1, 2, 3]), 2, 2)).toThrow(
        'does not match dimensions',
      );
    });

    it('returns an OffscreenCanvas with the correct dimensions', () => {
      const cm = new ColorMapper(RED_BLUE_PALETTE, 0, 1);
      const canvas = cm.render(new Float32Array([0, 0, 0, 0]), 2, 2);
      expect(canvas.width).toBe(2);
      expect(canvas.height).toBe(2);
    });

    it('handles a 1×1 image without throwing', () => {
      const cm = new ColorMapper(RED_BLUE_PALETTE, 0, 1);
      expect(() => cm.render(new Float32Array([0.5]), 1, 1)).not.toThrow();
    });

    it('handles a non-square image', () => {
      const cm = new ColorMapper(RED_BLUE_PALETTE, 0, 1);
      const canvas = cm.render(new Float32Array(3 * 5), 3, 5);
      expect(canvas.width).toBe(3);
      expect(canvas.height).toBe(5);
    });

    // Pixel-level tests require an environment with real canvas rendering support
    // (e.g. a browser or Playwright). happy-dom stubs the 2D context without
    // performing actual pixel operations, so these are skipped there.

    it.skipIf(!pixelReadbackAvailable)('maps minValue to the first palette color', () => {
      const cm = new ColorMapper([0xff0000ff, 0x0000ffff], 0, 1);
      const canvas = cm.render(new Float32Array([0]), 1, 1);
      const data = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data;
      // 0xFF0000FF little-endian → bytes [0xFF, 0x00, 0x00, 0xFF]
      expect(data[0]).toBe(0xff);
      expect(data[1]).toBe(0x00);
      expect(data[2]).toBe(0x00);
      expect(data[3]).toBe(0xff);
    });

    it.skipIf(!pixelReadbackAvailable)('maps maxValue to the last palette color', () => {
      const cm = new ColorMapper([0xff0000ff, 0x0000ffff], 0, 1);
      const canvas = cm.render(new Float32Array([1]), 1, 1);
      const data = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data;
      // 0x0000FFFF little-endian → bytes [0xFF, 0xFF, 0x00, 0x00]
      expect(data[0]).toBe(0xff);
      expect(data[1]).toBe(0xff);
      expect(data[2]).toBe(0x00);
      expect(data[3]).toBe(0x00);
    });

    it.skipIf(!pixelReadbackAvailable)(
      'clamps values below minValue to first palette entry',
      () => {
        const cm = new ColorMapper([0xff0000ff, 0x0000ffff], 0, 1);
        const canvas = cm.render(new Float32Array([-999]), 1, 1);
        const data = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data;
        expect(data[0]).toBe(0xff); // same as minValue color
        expect(data[1]).toBe(0x00);
      },
    );

    it.skipIf(!pixelReadbackAvailable)('clamps values above maxValue to last palette entry', () => {
      const cm = new ColorMapper([0xff0000ff, 0x0000ffff], 0, 1);
      const canvas = cm.render(new Float32Array([999]), 1, 1);
      const data = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data;
      expect(data[0]).toBe(0xff); // same as maxValue color
      expect(data[1]).toBe(0xff);
    });
  });
});
