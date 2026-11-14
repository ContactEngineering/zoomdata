import { beforeEach, describe, expect, it } from 'vitest';
import { Scalebar } from './Scalebar';

let bar: HTMLElement;
let label: HTMLElement;

beforeEach(() => {
  bar = document.createElement('div');
  label = document.createElement('div');
});

/** Bar width in CSS pixels */
const width = () => parseFloat(bar.style.width);

describe('Scalebar', () => {
  // One image pixel is 1 µm
  const ppm = 1e6;

  it('shows a round length close to 100 screen pixels', () => {
    const scalebar = new Scalebar(bar, label, ppm);
    // 1 screen pixel per µm: 100 px is exactly 100 µm
    scalebar.update(1);
    expect(label.textContent).toBe('100 µm');
    expect(width()).toBeCloseTo(100, 9);

    // 0.37 px per µm: 100 px are 270 µm; the nearest round length is 200 µm
    scalebar.update(0.37);
    expect(label.textContent).toBe('200 µm');
    expect(width()).toBeCloseTo(74, 9);
  });

  it('rounds to 1, 2 or 5 times a power of ten', () => {
    const scalebar = new Scalebar(bar, label, ppm);
    const cases: [number, string][] = [
      [100 / 140, '100 µm'], // 140 µm
      [100 / 160, '200 µm'], // 160 µm
      [100 / 340, '200 µm'], // 340 µm
      [100 / 360, '500 µm'], // 360 µm
      [100 / 740, '500 µm'], // 740 µm
    ];
    for (const [k, text] of cases) {
      scalebar.update(k);
      expect(label.textContent).toBe(text);
      // The bar is as long as the length it shows
      expect(width() / k).toBeCloseTo(parseFloat(text), 4);
    }
    // 760 µm round up to 1 mm
    scalebar.update(100 / 760);
    expect(label.textContent).toBe('1 mm');
    expect(width()).toBeCloseTo(1000 * (100 / 760), 6);
  });

  it('switches units between mm, µm and nm', () => {
    const scalebar = new Scalebar(bar, label, ppm);
    scalebar.update(0.01); // 100 px are 10 mm
    expect(label.textContent).toBe('10 mm');
    scalebar.update(10); // 10 µm
    expect(label.textContent).toBe('10 µm');
    scalebar.update(1000); // 100 nm
    expect(label.textContent).toBe('100 nm');
    expect(width()).toBeCloseTo(100, 9);
  });

  it('uses the pixel size of the map', () => {
    // One image pixel is 25 nm
    const scalebar = new Scalebar(bar, label, 4e7);
    scalebar.update(2); // 100 px are 50 image pixels, 1.25 µm
    expect(label.textContent).toBe('1 µm');
    expect(width()).toBeCloseTo(80, 9);
  });
});
