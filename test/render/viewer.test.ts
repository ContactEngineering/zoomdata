/**
 * ZoomData, the ready-made viewer, with several instances on one page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ZoomData } from '../../src/ZoomData';
import { BACKGROUND, NO_DATA, readPixels } from './driver';
import {
  compare,
  expectedImage,
  fixtureUrl,
  formatComparison,
  loadReference,
  testPalette,
} from './harness';

const OPTIONS = { background: BACKGROUND, noData: NO_DATA };
const cleanup: (() => void)[] = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.style.width = `${width}px`;
  c.style.height = `${height}px`;
  c.style.display = 'block';
  document.body.appendChild(c);
  cleanup.push(() => c.remove());
  return c;
}

async function viewer(fixture: string) {
  const main = canvas(200, 160);
  const crosshair = canvas(200, 160);
  // Read back from the CPU: GPU-backed 2D canvases in headless Chromium may
  // return a stale image after clearRect
  crosshair.getContext('2d', { willReadFrequently: true });
  const hScan = canvas(200, 60);
  const vScan = canvas(60, 160);
  const zoomData = new ZoomData({
    rootUrl: fixtureUrl(fixture),
    colorPalette: testPalette(),
    noDataColor: (NO_DATA[0] | (NO_DATA[1] << 8) | (NO_DATA[2] << 16) | (255 << 24)) >>> 0,
    crosshairCanvas: crosshair,
    horizontalScanCanvas: hScan,
    verticalScanCanvas: vScan,
  });
  await zoomData.start(main);
  cleanup.push(() => zoomData.stop());
  return { zoomData, main, crosshair, hScan };
}

async function settle(zoomData: ZoomData) {
  const engine = zoomData.getEngine()!;
  engine.render();
  await expect.poll(() => engine.isLoading(), { timeout: 5000 }).toBe(false);
  engine.render();
}

function inked(c: HTMLCanvasElement): number {
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}

describe('ZoomData', () => {
  it('runs two viewers on one page independently', async () => {
    const a = await viewer('pattern-ov1');
    const b = await viewer('nan-v2');
    const viewA = { k: 1, x: 5, y: 3 };
    const viewB = { k: 0.5, x: 10, y: 6 };
    a.zoomData.setView(viewA);
    b.zoomData.setView(viewB);
    await settle(a.zoomData);
    await settle(b.zoomData);

    for (const [v, fixture, view] of [
      [a, 'pattern-ov1', viewA],
      [b, 'nan-v2', viewB],
    ] as const) {
      const ref = await loadReference(fixture);
      // Read in the task that renders: the drawing buffer is not preserved
      v.zoomData.getEngine()!.render();
      const expected = expectedImage(ref, { k: view.k, tx: view.x, ty: view.y }, 200, 160);
      const result = compare(readPixels(v.main), expected, 200, OPTIONS);
      expect(result.mismatches, `${fixture}\n${formatComparison(result)}`).toBe(0);
    }

    // The crosshair goes to the first viewer's overlay only
    a.zoomData.placeCrosshair(40, 30);
    a.zoomData.getEngine()!.render();
    b.zoomData.getEngine()!.render();
    expect(inked(a.crosshair)).toBeGreaterThan(0);
    expect(inked(b.crosshair)).toBe(0);

    a.zoomData.clearCrosshair();
    a.zoomData.getEngine()!.render();
    expect(inked(a.crosshair)).toBe(0);
  });

  it('accepts the id of the main canvas', async () => {
    const c = canvas(100, 80);
    c.id = 'zoomdata-test-canvas';
    const zoomData = new ZoomData({ rootUrl: fixtureUrl('flat-v2') });
    await zoomData.start('zoomdata-test-canvas');
    cleanup.push(() => zoomData.stop());
    expect(zoomData.getEngine()!.canvas).toBe(c);
    await expect(new ZoomData({ rootUrl: fixtureUrl('flat-v2') }).start('missing')).rejects.toThrow(
      'not found',
    );
  });
});
