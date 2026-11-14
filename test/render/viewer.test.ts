/**
 * ZoomData, the ready-made viewer, with several instances on one page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RELIEF, type ReliefOptions } from '../../src/relief';
import { ZoomData } from '../../src/ZoomData';
import { BACKGROUND, NO_DATA, readPixels } from './driver';
import {
  compare,
  expectedImage,
  fixtureUrl,
  formatComparison,
  loadReference,
  referenceValue,
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

  it('reports the map described by the descriptor', async () => {
    const ref = await loadReference('pattern-ov1');
    const { zoomData } = await viewer('pattern-ov1');
    expect(zoomData.getImageWidth()).toBe(150);
    expect(zoomData.getImageHeight()).toBe(100);
    expect(zoomData.getMaxZoomLevel()).toBe(8);
    expect(zoomData.getOverlap()).toBe(1);
    expect(zoomData.getMinColorBarRange()).toBe(ref.colorbarRange.Minimum);
    expect(zoomData.getMaxColorBarRange()).toBe(ref.colorbarRange.Maximum);
    expect(zoomData.getColorbarTitle()).toBe('Height (µm)');
    // Pixels are 0.5 µm
    expect(zoomData.getPixelsPerMeterWidth()).toBeCloseTo(2e6, 3);
    expect(zoomData.getPixelsPerMeterHeight()).toBeCloseTo(2e6, 3);
  });

  it('returns neutral values before it is started', () => {
    const zoomData = new ZoomData({ rootUrl: fixtureUrl('pattern-ov1') });
    expect(zoomData.getEngine()).toBeNull();
    expect(zoomData.getView()).toBeNull();
    expect(zoomData.getZoomLevel()).toBe(0);
    expect(zoomData.getMaxZoomLevel()).toBe(0);
    expect(zoomData.getImageWidth()).toBe(0);
    expect(zoomData.getColorbarTitle()).toBeNull();
    expect(zoomData.getPosition()).toEqual({ x: 0, y: 0 });
    expect(zoomData.screenToImage(10, 10)).toBeNull();
    expect(zoomData.sampleAt(10, 10)).toBeNull();
    expect(zoomData.getCrosshair()).toBeNull();
    // Setters do nothing rather than throw
    zoomData.setZoomLevel(3);
    zoomData.setPosition(1, 2);
    zoomData.resetView();
    expect(zoomData.getView()).toBeNull();
  });

  it('relates zoom levels to the view scale and keeps the centre fixed', async () => {
    const { zoomData } = await viewer('pattern-ov1');
    const onZoomChange = vi.fn();
    zoomData.onZoomChange = onZoomChange;
    zoomData.setView({ k: 0.5, x: 30, y: 20 });
    expect(zoomData.getZoomLevel()).toBe(7);
    expect(onZoomChange).toHaveBeenLastCalledWith(7);

    // The image point under the centre of the 200 x 160 canvas stays there
    const centre = zoomData.screenToImage(100, 80)!;
    zoomData.setZoomLevel(9);
    expect(zoomData.getView()!.k).toBe(2);
    expect(zoomData.getZoomLevel()).toBe(9);
    expect(onZoomChange).toHaveBeenLastCalledWith(9);
    const after = zoomData.screenToImage(100, 80)!;
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.y).toBeCloseTo(centre.y, 9);
  });

  it('moves the view and fits it to the canvas', async () => {
    const { zoomData } = await viewer('pattern-ov1');
    zoomData.setView({ k: 2, x: 0, y: 0 });
    zoomData.setPosition(-40, 15);
    expect(zoomData.getPosition()).toEqual({ x: -40, y: 15 });
    expect(zoomData.getView()).toEqual({ k: 2, x: -40, y: 15, rotation: 0, tilt: 0 });
    expect(zoomData.screenToImage(0, 15)).toEqual({ x: 20, y: 0 });

    // 150 x 100 in 200 x 160: the width limits the scale
    zoomData.resetView();
    const view = zoomData.getView()!;
    expect(view.k).toBeCloseTo(200 / 150, 12);
    expect(view.x).toBeCloseTo(0, 12);
    expect(view.y).toBeCloseTo((160 - (200 / 150) * 100) / 2, 12);
  });

  it('samples values from the tiles it has drawn', async () => {
    const ref = await loadReference('nan-v2');
    const { zoomData } = await viewer('nan-v2');
    zoomData.setView({ k: 1, x: 0, y: 0 });
    await settle(zoomData);
    const p = zoomData.screenToImage(97.5, 66.5)!;
    const s = zoomData.sampleAt(p.x, p.y)!;
    expect(s.level).toBe(ref.maxLevel);
    expect(s.value).toBeCloseTo(referenceValue(ref, ref.maxLevel, p.x, p.y)!, 6);
    // Inside the hole of undefined points
    expect(zoomData.sampleAt(40, 60)!.value).toBeNaN();
  });

  it('places the crosshair inside the map and reports it', async () => {
    const { zoomData } = await viewer('pattern-ov1');
    const onCrosshairChange = vi.fn();
    zoomData.onCrosshairChange = onCrosshairChange;
    zoomData.placeCrosshair(-5, 500);
    expect(zoomData.getCrosshair()).toEqual({ x: 0, y: 99 });
    expect(onCrosshairChange).toHaveBeenLastCalledWith(0, 99);
    zoomData.placeCrosshair(40.5, 30.25);
    expect(zoomData.getCrosshair()).toEqual({ x: 40.5, y: 30.25 });

    zoomData.clearCrosshair();
    expect(zoomData.getCrosshair()).toBeNull();
    // Clearing is not reported as a position
    expect(onCrosshairChange).toHaveBeenCalledTimes(2);
  });

  it('places the crosshair on double click', async () => {
    const { zoomData, main } = await viewer('pattern-ov1');
    zoomData.setView({ k: 2, x: 10, y: 20 });
    const rect = main.getBoundingClientRect();
    main.dispatchEvent(
      new MouseEvent('dblclick', { clientX: rect.left + 50, clientY: rect.top + 60 }),
    );
    expect(zoomData.getCrosshair()).toEqual({ x: 20, y: 20 });
  });

  it('can run without input handling', async () => {
    const c = canvas(200, 160);
    const zoomData = new ZoomData({ rootUrl: fixtureUrl('pattern-ov1'), controller: false });
    await zoomData.start(c);
    cleanup.push(() => zoomData.stop());
    const view = zoomData.getView();
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    c.dispatchEvent(new MouseEvent('dblclick'));
    expect(zoomData.getView()).toEqual(view);
    expect(zoomData.getCrosshair()).toBeNull();
  });

  it('draws with a new colour range and palette', async () => {
    const ref = await loadReference('pattern-ov1');
    const { zoomData, main } = await viewer('pattern-ov1');
    const view = { k: 1, x: 5, y: 3 };
    zoomData.setView(view);
    await settle(zoomData);
    const { Minimum: mn, Maximum: mx } = ref.colorbarRange;
    const range: [number, number] = [mn + 0.2 * (mx - mn), mn + 0.6 * (mx - mn)];
    zoomData.setColorRange(...range);
    zoomData.getEngine()!.render();
    const expected = expectedImage(ref, { k: 1, tx: 5, ty: 3 }, 200, 160, { colorRange: range });
    const result = compare(readPixels(main), expected, 200, OPTIONS);
    expect(result.mismatches, formatComparison(result)).toBe(0);

    // A palette of a single colour paints the whole map in it
    zoomData.setColorPalette([0xff336699]);
    zoomData.getEngine()!.render();
    const pixels = readPixels(main);
    const at = (x: number, y: number) => [
      ...pixels.slice(4 * (y * 200 + x), 4 * (y * 200 + x) + 3),
    ];
    expect(at(10, 10)).toEqual([0x99, 0x66, 0x33]);
    expect(at(150, 100)).toEqual([0x99, 0x66, 0x33]);
    // Outside the map
    expect(at(190, 150)).toEqual(BACKGROUND);
  });

  it('draws with relief shading, set as an option or later', async () => {
    const ref = await loadReference('pattern-ov1');
    const c = canvas(200, 160);
    const zoomData = new ZoomData({
      rootUrl: fixtureUrl('pattern-ov1'),
      colorPalette: testPalette(),
      relief: { azimuth: 45 },
    });
    await zoomData.start(c);
    cleanup.push(() => zoomData.stop());
    zoomData.setView({ k: 1, x: 5, y: 3 });
    await settle(zoomData);
    const shadedImage = (relief?: Required<ReliefOptions>) => {
      zoomData.getEngine()!.render();
      const expected = expectedImage(ref, { k: 1, tx: 5, ty: 3 }, 200, 160, { relief });
      const result = compare(readPixels(c), expected, 200, OPTIONS);
      expect(result.mismatches, formatComparison(result)).toBe(0);
    };
    shadedImage({ ...DEFAULT_RELIEF, azimuth: 45 });
    zoomData.setRelief({ exaggeration: 3 });
    shadedImage({ ...DEFAULT_RELIEF, exaggeration: 3 });
    zoomData.setRelief(false);
    shadedImage();
  });

  it('reports a pyramid that cannot be loaded', async () => {
    const zoomData = new ZoomData({ rootUrl: fixtureUrl('missing') });
    const onError = vi.fn();
    zoomData.onError = onError;
    await expect(zoomData.start(canvas(100, 80))).rejects.toThrow('HTTP 404');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('HTTP 404') }),
    );
    expect(zoomData.getEngine()).toBeNull();
  });

  it('needs a source and a canvas', async () => {
    expect(() => new ZoomData({})).toThrow('either source or rootUrl');
    const div = document.createElement('div');
    div.id = 'zoomdata-test-div';
    document.body.appendChild(div);
    cleanup.push(() => div.remove());
    await expect(
      new ZoomData({ rootUrl: fixtureUrl('flat-v2') }).start('zoomdata-test-div'),
    ).rejects.toThrow('not a canvas');
  });
});
