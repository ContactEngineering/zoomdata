import { afterEach, describe, expect, it } from 'vitest';
import { orbit } from '../../src/camera';
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
    // Values are located at the first point of their block
    expect([...h.positions.slice(0, 3)]).toEqual([0, 2, 4]);
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

  it('drapes the crosshair lines over the surface in the tilted view', async () => {
    const ref = await loadReference('pattern-ov1');
    driver = await createDriver(ref, { verticalExaggeration: 20 });
    const overlay = canvas(200, 160);
    // Read back from the CPU, see viewer.test.ts
    const ctx = overlay.getContext('2d', { willReadFrequently: true })!;
    const sections = new CrossSections(driver.engine, { overlayCanvas: overlay });
    cleanup.push(() => sections.dispose());
    const engine = driver.engine;
    const view = orbit({ k: 2, tx: -50, ty: -20, rotation: 0, tilt: 0 }, 25, 55, 100, 80);
    await driver.render(view);
    sections.place(75.5, 50.5);
    await driver.render(view);

    const inked = (x: number, y: number) => {
      const d = ctx.getImageData(Math.round(x) - 1, Math.round(y) - 1, 3, 3).data;
      return d.some((value, i) => i % 4 === 3 && value > 0);
    };
    // The lines pass through the points of the surface along the row and
    // the column of the crosshair, not through the reference plane
    let offPlane = 0;
    for (const [u, v] of [
      [60.5, 50.5],
      [90.5, 50.5],
      [75.5, 40.5],
      [75.5, 60.5],
      [75.5, 50.5],
    ]) {
      const value = referenceValue(ref, ref.maxLevel, u, v)!;
      // Profile values belong to the middle of their pixel
      const onSurface = engine.imageToScreen(Math.floor(u) + 0.5, Math.floor(v) + 0.5, value);
      expect(inked(onSurface.x, onSurface.y)).toBe(true);
      const onPlane = engine.imageToScreen(u, v);
      if (Math.hypot(onPlane.x - onSurface.x, onPlane.y - onSurface.y) > 4) offPlane++;
    }
    // The surface is well off the plane at some of them, so this tells
    expect(offPlane).toBeGreaterThan(1);

    sections.clear();
    engine.render();
    expect(ctx.getImageData(0, 0, 200, 160).data.some((value) => value > 0)).toBe(false);
  });
});
