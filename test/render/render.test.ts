import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportsWebGL2 } from '../../src/WebGLRenderer';
import { ZoomEngine } from '../../src/ZoomEngine';
import { StaticTileSource, type TileSource } from '../../src/TileSource';
import { BACKGROUND, NO_DATA, createDriver, type Driver, type DriverOptions } from './driver';
import {
  compare,
  expectedImage,
  fixtureUrl,
  formatComparison,
  loadReference,
  referenceValue,
  writeDiagnostics,
  type ExpectOptions,
  type Reference,
  type View,
} from './harness';

const WIDTH = 200;
const HEIGHT = 160;
const OPTIONS = { background: BACKGROUND, noData: NO_DATA };

let driver: Driver | null = null;
afterEach(() => {
  driver?.dispose();
  driver = null;
});

async function setup(name: string, options: Omit<DriverOptions, 'width' | 'height'> = {}) {
  const ref = await loadReference(name);
  driver = await createDriver(ref, { width: WIDTH, height: HEIGHT, ...options });
  return { ref, driver };
}

async function check(
  label: string,
  ref: Reference,
  pixels: Uint8Array,
  view: View,
  options: ExpectOptions = {},
) {
  const expected = expectedImage(ref, view, WIDTH, HEIGHT, options);
  const result = compare(pixels, expected, WIDTH, OPTIONS);
  if (result.mismatches > 0) {
    await writeDiagnostics(label, pixels, expected, WIDTH, HEIGHT, OPTIONS);
  }
  expect(result.checked).toBeGreaterThan(0);
  expect(result.mismatches, formatComparison(result)).toBe(0);
}

// Views exercising the finest level 1:1, magnified, sub-pixel offsets, and
// coarser levels; tx/ty are chosen so the image is partly off screen too
const VIEWS: Record<string, View> = {
  'finest level, 1:1': { k: 1, tx: 5, ty: 3 },
  'finest level, sub-pixel offset': { k: 1, tx: 5.3, ty: 2.7 },
  'magnified 2x': { k: 2, tx: -20.3, ty: -10.6 },
  'magnified 4x across tile borders': { k: 4, tx: -100.2, ty: -90.6 },
  'level max-1, 1:2': { k: 0.5, tx: 10, ty: 6 },
  'level max-2, 1:4': { k: 0.25, tx: 10.4, ty: 6.2 },
  'level max-3, 1:8': { k: 0.125, tx: 10, ty: 6 },
  'between levels (k=0.7)': { k: 0.7, tx: 4.1, ty: 3.3 },
  'panned off the top left': { k: 1, tx: -60.4, ty: -45.2 },
};

for (const fixture of ['pattern-ov1', 'pattern-ov0', 'pattern-ov2']) {
  describe(`${fixture}`, () => {
    for (const [name, view] of Object.entries(VIEWS)) {
      it(name, async () => {
        const { ref, driver } = await setup(fixture);
        await check(`${fixture} ${name}`, ref, await driver.render(view), view);
      });
    }

    it('falls back to a cached coarser level while tiles load', async () => {
      const { ref, driver } = await setup(fixture);
      const coarse = ref.maxLevel - 2;
      await driver.render({ k: 0.25, tx: 0, ty: 0 });
      const release = driver.blockTiles(new RegExp(`/dzdata_files/${ref.maxLevel}/`));
      try {
        const view = { k: 1, tx: 5, ty: 3 };
        await check(`${fixture} fallback`, ref, driver.renderNow(view), view, { level: coarse });
      } finally {
        release();
      }
    });
  });
}

describe('tile source', () => {
  // Tiles are addressed only through the source; this one hands out a
  // different, query-signed URL per tile, as a host with presigned URLs would
  it('renders tiles from per-tile URLs', async () => {
    const ref = await loadReference('pattern-ov1');
    const inner = new StaticTileSource(fixtureUrl('pattern-ov1'));
    const requested: string[] = [];
    const source: TileSource = {
      descriptor: () => inner.descriptor(),
      async tileUrl(level, col, row) {
        const url = `${await inner.tileUrl(level, col, row)}?sig=${level}-${col}-${row}`;
        requested.push(url);
        return url;
      },
    };
    const { driver } = await setup('pattern-ov1', { source });
    const view = { k: 1, tx: 5, ty: 3 };
    const pixels = await driver.render(view);
    expect(requested).toContain(`${fixtureUrl('pattern-ov1')}dzdata_files/8/0_0.nc?sig=8-0-0`);
    await check('tile source', ref, pixels, view);
  });
});

describe('tile loader', () => {
  it('recovers from expired tile URLs', async () => {
    // URLs carry a token; the server rejects all but the current one with 403
    const ref = await loadReference('pattern-ov1');
    const inner = new StaticTileSource(fixtureUrl('pattern-ov1'));
    let token = 0;
    const invalidated: string[] = [];
    const source: TileSource = {
      descriptor: () => inner.descriptor(),
      async tileUrl(level, col, row) {
        return `${await inner.tileUrl(level, col, row)}?token=${token}`;
      },
      invalidate(level, col, row) {
        invalidated.push(`${level}/${col}_${row}`);
        token = 1;
      },
    };
    const { driver } = await setup('pattern-ov1', { source });
    const restore = driver.rejectTiles(/token=0/, 403);
    try {
      const view = { k: 1, tx: 5, ty: 3 };
      await check('expired URLs', ref, await driver.render(view), view);
      expect(invalidated.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('draws a coarser level while finer tiles load', async () => {
    // Nothing was loaded before; the base level (5) loads first
    const { ref, driver } = await setup('pattern-ov2');
    const view = { k: 1, tx: 5, ty: 3 };
    const release = driver.blockTiles(new RegExp(`/dzdata_files/${ref.maxLevel}/`));
    try {
      await driver.render(view, () => driver.sampleAt(0, 0) !== null);
      await check('base level first', ref, driver.renderNow(view), view, {
        level: ref.maxLevel - 3,
      });
    } finally {
      release();
    }
  });
});

describe('colour range', () => {
  it('maps a narrower range and clamps outside it', async () => {
    const { ref, driver } = await setup('pattern-ov1');
    const { Minimum: mn, Maximum: mx } = ref.colorbarRange;
    const range: [number, number] = [mn + 0.25 * (mx - mn), mn + 0.75 * (mx - mn)];
    const view = { k: 1, tx: 5, ty: 3 };
    await driver.render(view);
    driver.setColorRange(...range);
    await check('colour range', ref, await driver.render(view), view, { colorRange: range });
  });
});

describe('sampling', () => {
  it('reads the finest level in memory, without fetching', async () => {
    const { ref, driver } = await setup('nan-v2');
    await driver.render({ k: 0.25, tx: 0, ty: 0 });
    const fetches = driver.tileFetches();
    const coarse = driver.sampleAt(97.3, 66.1)!;
    expect(coarse.level).toBe(ref.maxLevel - 2);
    expect(coarse.value).toBeCloseTo(referenceValue(ref, ref.maxLevel - 2, 97.3, 66.1)!, 6);
    expect(driver.tileFetches()).toBe(fetches);

    await driver.render({ k: 1, tx: 0, ty: 0 });
    const fine = driver.sampleAt(97.3, 66.1)!;
    expect(fine.level).toBe(ref.maxLevel);
    expect(fine.value).toBeCloseTo(referenceValue(ref, ref.maxLevel, 97.3, 66.1)!, 6);
    // Inside the hole of undefined points
    expect(driver.sampleAt(40, 60)!.value).toBeNaN();
  });
});

describe('tile cache', () => {
  it('stays within its byte budget while panning', async () => {
    // A finest-level tile is 34 x 34 float32 values on the CPU and as much
    // again on the GPU: 9.2 kB. The budget holds the four tiles a view may
    // show and the base level, but not a fifth tile.
    const budget = 45_000;
    const { ref, driver } = await setup('pattern-ov1', { cacheBytes: budget });
    const deleted = vi.spyOn(WebGL2RenderingContext.prototype, 'deleteTexture');
    try {
      for (const [tx, ty] of [
        [-20, -20],
        [-300, -20],
        [-500, -250],
        [-20, -250],
        [-20, -20],
      ]) {
        const view = { k: 4, tx: tx + 0.3, ty: ty + 0.6 };
        await check(`cache ${tx} ${ty}`, ref, await driver.render(view), view);
        expect(driver.cacheStats().bytes).toBeLessThanOrEqual(budget);
      }
      expect(deleted).toHaveBeenCalled();
      // The last view shows the top left; elsewhere the base level (5) is
      // still in memory, since it is pinned
      expect(driver.sampleAt(10, 10)!.level).toBe(8);
      expect(driver.sampleAt(149, 99)!.level).toBe(5);
    } finally {
      deleted.mockRestore();
    }
  });
});

describe('tile cache over budget', () => {
  it('keeps the tiles in view even if they exceed the budget', async () => {
    // All 20 tiles of the finest level are in view, about 200 kB. Evicting
    // tiles in view would refetch them on every frame.
    const budget = 30_000;
    const { ref, driver } = await setup('pattern-ov1', { cacheBytes: budget });
    const view = { k: 1, tx: 5, ty: 3 };
    await check('over budget', ref, await driver.render(view), view);
    const fetches = driver.tileFetches();
    for (let i = 0; i < 5; i++) {
      await check('over budget', ref, await driver.render(view), view);
    }
    expect(driver.tileFetches()).toBe(fetches);
    expect(driver.cacheStats().bytes).toBeGreaterThan(budget);

    // Tiles are released again once they leave the view; this one shows a
    // single tile
    const corner = { k: 8, tx: -16.3, ty: -16.6 };
    await check('over budget corner', ref, await driver.render(corner), corner);
    expect(driver.cacheStats().bytes).toBeLessThanOrEqual(budget);
  });
});

describe('canvas size', () => {
  it('renders at the device pixel ratio', async () => {
    // Views in these tests are in device pixels; the engine gets CSS pixels
    const { ref, driver } = await setup('pattern-ov1', { pixelRatio: 2 });
    expect([driver.canvas.width, driver.canvas.height]).toEqual([2 * WIDTH, 2 * HEIGHT]);
    const view = { k: 2, tx: 10.4, ty: 6.2 };
    const pixels = await driver.render(view);
    const expected = expectedImage(ref, view, 2 * WIDTH, 2 * HEIGHT);
    const result = compare(pixels, expected, 2 * WIDTH, OPTIONS);
    expect(result.mismatches, formatComparison(result)).toBe(0);
    // At k = 2 device pixels per image pixel the finest level is drawn
    expect(driver.engine.level).toBe(ref.maxLevel);
  });

  it('keeps the layout size of a canvas sized by its attributes', async () => {
    // Without a CSS size, the buffer size is the layout size; resizing the
    // buffer for the pixel ratio must not grow the canvas
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 160;
    canvas.style.border = '1px solid black';
    document.body.appendChild(canvas);
    const engine = await ZoomEngine.create(canvas, { source: fixtureUrl('flat-v2') });
    try {
      await new Promise((r) => setTimeout(r, 300));
      expect([canvas.width, canvas.height]).toEqual([400, 320]);
      expect([canvas.clientWidth, canvas.clientHeight]).toEqual([200, 160]);
      expect(engine.size).toEqual({ width: 200, height: 160 });
    } finally {
      engine.dispose();
      canvas.remove();
      delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
  });

  it('follows CSS size changes', async () => {
    const { ref, driver } = await setup('pattern-ov0');
    driver.canvas.style.width = '120px';
    driver.canvas.style.height = '90px';
    await expect.poll(() => driver.canvas.width).toBe(120);
    expect(driver.canvas.height).toBe(90);
    expect(driver.engine.size).toEqual({ width: 120, height: 90 });
    const view = { k: 1, tx: 5, ty: 3 };
    const pixels = await driver.render(view);
    const expected = expectedImage(ref, view, 120, 90);
    expect(compare(pixels, expected, 120, OPTIONS).mismatches).toBe(0);
  });
});

describe('WebGL2 renderer', () => {
  it('is supported in the test browser', () => {
    expect(supportsWebGL2()).toBe(true);
  });

  it('changes the colour range without re-uploading textures', async () => {
    const { ref, driver } = await setup('pattern-ov1');
    const view = { k: 1, tx: 5, ty: 3 };
    await driver.render(view);
    const proto = WebGL2RenderingContext.prototype;
    const upload = vi.spyOn(proto, 'texImage2D');
    try {
      const { Minimum: mn, Maximum: mx } = ref.colorbarRange;
      const range: [number, number] = [mn, (mn + mx) / 2];
      driver.setColorRange(...range);
      await check('range no upload', ref, driver.renderNow(view), view, { colorRange: range });
      expect(upload).not.toHaveBeenCalled();
    } finally {
      upload.mockRestore();
    }
  });

  it('restores after context loss without refetching tiles', async () => {
    const { ref, driver } = await setup('nan-v2');
    const view = { k: 1, tx: 5, ty: 3 };
    await driver.render(view);
    const fetches = driver.tileFetches();
    await driver.loseContext();
    await check('context loss', ref, driver.renderNow(view), view);
    expect(driver.tileFetches()).toBe(fetches);
  });
});

describe('undefined points and format version 2', () => {
  for (const fixture of ['nan-v1', 'nan-v2']) {
    for (const [name, view] of Object.entries({
      'finest level': { k: 1, tx: 5, ty: 3 },
      'level max-2': { k: 0.25, tx: 10.4, ty: 6.2 },
    })) {
      it(`${fixture}: ${name}`, async () => {
        const { ref, driver } = await setup(fixture);
        await check(`${fixture} ${name}`, ref, await driver.render(view), view);
      });
    }
  }

  it('flat-v2: constant map', async () => {
    const { ref, driver } = await setup('flat-v2', { colorRange: [0, 1] });
    const view = { k: 2, tx: 7, ty: 5 };
    await check('flat-v2', ref, await driver.render(view), view, { colorRange: [0, 1] });
  });
});
