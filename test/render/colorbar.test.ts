import { afterEach, describe, expect, it, vi } from 'vitest';
import { Colorbar } from '../../src/Colorbar';

// Four bands: red, green, blue, white (ABGR)
const PALETTE = [0xff0000ff, 0xff00ff00, 0xffff0000, 0xffffffff];
const RED = [255, 0, 0];
const WHITE = [255, 255, 255];

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function setup(options: Partial<ConstructorParameters<typeof Colorbar>[0]> = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 240;
  document.body.appendChild(canvas);
  cleanup.push(() => canvas.remove());
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const texts: { text: string; y: number }[] = [];
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (text: string, x: number, y: number) => {
    texts.push({ text, y });
    fillText(text, x, y);
  };
  const colorbar = new Colorbar({
    canvas,
    palette: PALETTE,
    minValue: -1,
    maxValue: 1,
    fontSize: 12,
    barThickness: 24,
    ...options,
  });
  const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
  return { canvas, colorbar, texts, pixel };
}

// Layout for font size 12, bar 24 px, no title: the bar spans x 2..26 and
// y 8..232 (8 px margins), with a 1 px border
const BAR_X = 14;
const BAR_TOP = 8;
const BAR_BOTTOM = 232;

describe('Colorbar', () => {
  it('draws the palette with the maximum at the top', () => {
    const { colorbar, pixel } = setup();
    colorbar.render();
    expect(pixel(BAR_X, BAR_TOP + 2)).toEqual(WHITE);
    expect(pixel(BAR_X, BAR_BOTTOM - 2)).toEqual(RED);
    // Four equal bands of 56 px, as the renderer maps values to entries
    const band = (BAR_BOTTOM - BAR_TOP) / 4;
    const colors = [WHITE, [0, 0, 255], [0, 255, 0], RED];
    colors.forEach((color, i) => {
      expect(pixel(BAR_X, BAR_TOP + i * band + 1)).toEqual(color);
      expect(pixel(BAR_X, BAR_TOP + (i + 1) * band - 2)).toEqual(color);
    });
  });

  it('labels round values at their height on the bar', () => {
    const { colorbar, texts } = setup({ numTicks: 5 });
    colorbar.render();
    // Steps of 2 / 4 are round already
    expect(texts.map((t) => t.text)).toEqual(['-1.0', '-0.5', '0.0', '0.5', '1.0']);

    const y = Object.fromEntries(texts.map((t) => [t.text, t.y]));
    expect(y['1.0']).toBe(BAR_TOP);
    expect(y['-1.0']).toBe(BAR_BOTTOM);
    expect(y['0.0']).toBe((BAR_TOP + BAR_BOTTOM) / 2);
  });

  it('rounds the tick step to 1, 2 or 5 times a power of ten', () => {
    const { colorbar, texts } = setup({ numTicks: 7 });
    colorbar.render();
    // Steps of 2 / 6 round to 0.2
    expect(texts.map((t) => t.text)).toEqual([
      '-1.0',
      '-0.8',
      '-0.6',
      '-0.4',
      '-0.2',
      '0.0',
      '0.2',
      '0.4',
      '0.6',
      '0.8',
      '1.0',
    ]);
  });

  it('only labels values inside the range', () => {
    const { colorbar, texts } = setup({ minValue: 0.013, maxValue: 0.087, numTicks: 4 });
    colorbar.render();
    // Steps of 0.025 round to 0.02; one decimal more than the magnitude of
    // the range (0.07) needs
    expect(texts.map((t) => t.text)).toEqual(['0.020', '0.040', '0.060', '0.080']);
    for (const t of texts) {
      const value = parseFloat(t.text);
      expect(t.y).toBeCloseTo(BAR_BOTTOM - ((value - 0.013) / 0.074) * (BAR_BOTTOM - BAR_TOP), 9);
    }
  });

  it('shows a single label for a constant map', () => {
    const { colorbar, texts } = setup({ minValue: 3, maxValue: 3 });
    colorbar.render();
    expect(texts.map((t) => t.text)).toEqual(['3.0']);
  });

  it('draws the title beside the bar and shifts the bar right', () => {
    const { colorbar, texts, pixel } = setup({ title: 'Height (µm)' });
    colorbar.render();
    expect(texts[texts.length - 1].text).toBe('Height (µm)');
    // The title takes font size + 6 px: the bar now spans x 20..44
    expect(pixel(32, BAR_TOP + 2)).toEqual(WHITE);
    expect(pixel(10, BAR_TOP + 2)).not.toEqual(WHITE);
  });

  it('redraws with a new range or palette', () => {
    const { colorbar, texts, pixel } = setup();
    colorbar.render();
    texts.length = 0;
    colorbar.setRange(0, 100);
    expect(texts.map((t) => t.text)).toEqual(['0', '20', '40', '60', '80', '100']);

    colorbar.setPalette([...PALETTE].reverse());
    expect(pixel(BAR_X, BAR_TOP + 2)).toEqual(RED);
    expect(pixel(BAR_X, BAR_BOTTOM - 2)).toEqual(WHITE);
  });

  it('needs a 2D context', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    expect(() => new Colorbar({ canvas, palette: PALETTE, minValue: 0, maxValue: 1 })).toThrow(
      '2D context',
    );
  });
});
