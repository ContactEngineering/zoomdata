import { afterEach, describe, expect, it } from 'vitest';
import { CrossSections } from '../../src/CrossSections';
import { createDriver, type Driver } from './driver';
import { loadReference, referenceValue } from './harness';

let driver: Driver | null = null;
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  driver?.dispose();
  driver = null;
});

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  document.body.appendChild(c);
  cleanup.push(() => c.remove());
  return c;
}

describe('CrossSections', () => {
  it('samples profiles at the view level that agree with sampleAt and the reference', async () => {
    const ref = await loadReference('nan-v2');
    driver = await createDriver(ref);
    const sections = new CrossSections(driver.engine, {
      horizontalCanvas: canvas(300, 100),
      verticalCanvas: canvas(100, 300),
    });
    cleanup.push(() => sections.dispose());

    // k = 0.5: level max-1, stride 2
    await driver.render({ k: 0.5, tx: 10.3, ty: 5.6 });
    sections.place(40.2, 61.7);
    await driver.render({ k: 0.5, tx: 10.3, ty: 5.6 });

    const h = sections.horizontalProfile()!;
    expect(h.level).toBe(ref.maxLevel - 1);
    expect(h.stride).toBe(2);
    // The whole image is visible: one value per level pixel
    expect(h.values.length).toBe(75);
    let nan = 0;
    for (let i = 0; i < h.values.length; i++) {
      const sample = driver.engine.sampleAt(h.positions[i], 61.7, h.level)!;
      const expected = referenceValue(ref, h.level, h.positions[i], 61.7)!;
      if (Number.isNaN(expected)) {
        expect(h.values[i]).toBeNaN();
        nan++;
      } else {
        expect(h.values[i]).toBe(sample.value);
        expect(h.values[i]).toBeCloseTo(expected, 6);
      }
    }
    // The line crosses the hole of undefined points
    expect(nan).toBeGreaterThan(0);

    const v = sections.verticalProfile()!;
    expect(v.values.length).toBe(50);
    for (let i = 0; i < v.values.length; i++) {
      const expected = referenceValue(ref, v.level, 40.2, v.positions[i])!;
      if (Number.isNaN(expected)) expect(v.values[i]).toBeNaN();
      else expect(v.values[i]).toBeCloseTo(expected, 6);
    }
  });

  it('loads the tiles along a line outside the view', async () => {
    const ref = await loadReference('pattern-ov1');
    driver = await createDriver(ref);
    const sections = new CrossSections(driver.engine, {
      horizontalCanvas: canvas(300, 100),
    });
    cleanup.push(() => sections.dispose());

    // The view shows image rows 0..40 (k = 4); the crosshair row is 90
    const view = { k: 4, tx: -20, ty: 0 };
    await driver.render(view);
    sections.place(10, 90);
    await driver.render(view);

    const h = sections.horizontalProfile()!;
    expect(h.level).toBe(ref.maxLevel);
    for (let i = 0; i < h.values.length; i++) {
      expect(h.values[i]).toBeCloseTo(referenceValue(ref, h.level, h.positions[i], 90)!, 6);
    }

    // Clearing releases the request
    sections.clear();
    expect(sections.horizontalProfile()).toBeNull();
  });
});
