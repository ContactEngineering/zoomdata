import { afterEach, describe, expect, it, vi } from 'vitest';
import { orbit, unproject } from '../../src/camera';
import { DEFAULT_RELIEF } from '../../src/relief';
import { supportsWebGL2 } from '../../src/WebGLRenderer';
import { ZoomEngine } from '../../src/ZoomEngine';
import { StaticTileSource, type TileSource } from '../../src/TileSource';
import { ZarrSource } from '../../src/ZarrSource';
import { BACKGROUND, NO_DATA, createDriver, type Driver, type DriverOptions } from './driver';
import {
  compare,
  expectedImage,
  fixtureUrl,
  formatComparison,
  loadReference,
  referenceValue,
  surfaceHeightAt,
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

describe('relief shading', () => {
  const RELIEF = DEFAULT_RELIEF;
  const RELIEF_VIEWS: Record<string, View> = {
    'finest level, 1:1': { k: 1, tx: 5.3, ty: 2.7 },
    'magnified 4x across tile borders': { k: 4, tx: -100.2, ty: -90.6 },
    'level max-2, 1:4': { k: 0.25, tx: 10.4, ty: 6.2 },
    'between levels (k=0.7)': { k: 0.7, tx: 4.1, ty: 3.3 },
  };

  // With overlap 1 and 2, slopes at tile borders use the neighbouring tile's
  // values; without overlap they are one-sided there and not checked
  for (const fixture of ['pattern-ov1', 'pattern-ov2', 'pattern-ov0']) {
    for (const [name, view] of Object.entries(RELIEF_VIEWS)) {
      it(`${fixture}: ${name}`, async () => {
        const { ref, driver } = await setup(fixture, { relief: true });
        await check(`relief ${fixture} ${name}`, ref, await driver.render(view), view, {
          relief: RELIEF,
        });
      });
    }
  }

  it('shades the map next to undefined points and the edge of the map', async () => {
    // Format version 2 with a hole; the view shows the hole and three edges
    const { ref, driver } = await setup('nan-v2', { relief: true });
    const view = { k: 2, tx: 30.3, ty: -40.6 };
    await check('relief nan-v2', ref, await driver.render(view), view, { relief: RELIEF });
  });

  it('follows the direction of the light, the exaggeration and the ambient light', async () => {
    const options = { azimuth: 100, altitude: 30, exaggeration: 0.4, ambient: 0.1 };
    const { ref, driver } = await setup('pattern-ov1', { relief: options });
    const view = { k: 1, tx: 5.3, ty: 2.7 };
    await check('relief options', ref, await driver.render(view), view, { relief: options });
  });

  it('shades a coarser level shown while finer tiles load', async () => {
    const { ref, driver } = await setup('pattern-ov2', { relief: true });
    const coarse = ref.maxLevel - 2;
    await driver.render({ k: 0.25, tx: 0, ty: 0 });
    const release = driver.blockTiles(new RegExp(`/dzdata_files/${ref.maxLevel}/`));
    try {
      const view = { k: 1, tx: 5, ty: 3 };
      await check('relief fallback', ref, driver.renderNow(view), view, {
        level: coarse,
        relief: RELIEF,
      });
    } finally {
      release();
    }
  });

  it('switches on and off without re-uploading textures', async () => {
    const { ref, driver } = await setup('pattern-ov1');
    const view = { k: 1, tx: 5, ty: 3 };
    await check('relief off', ref, await driver.render(view), view);
    const upload = vi.spyOn(WebGL2RenderingContext.prototype, 'texImage2D');
    try {
      driver.engine.setRelief(true);
      expect(driver.engine.relief).toEqual(RELIEF);
      await check('relief on', ref, driver.renderNow(view), view, { relief: RELIEF });
      driver.engine.setRelief(false);
      expect(driver.engine.relief).toBeNull();
      await check('relief off again', ref, driver.renderNow(view), view);
      expect(upload).not.toHaveBeenCalled();
    } finally {
      upload.mockRestore();
    }
  });

  it('assumes a height scale where the pixel size is unknown', async () => {
    // Without the pixel size, the range of the values is taken to be a
    // tenth of the smaller side of the map (100 pixels)
    const ref = await loadReference('pattern-ov1');
    const inner = new StaticTileSource(fixtureUrl('pattern-ov1'));
    const source: TileSource = {
      async descriptor() {
        const d = await inner.descriptor();
        delete d.Image.PixelsPerMeter;
        return d;
      },
      tileUrl: (level, col, row) => inner.tileUrl(level, col, row),
    };
    const { driver } = await setup('pattern-ov1', { source, relief: true });
    const view = { k: 1, tx: 5.3, ty: 2.7 };
    const span = ref.colorbarRange.Maximum - ref.colorbarRange.Minimum;
    const assumed = (0.1 * 100) / span;
    await check('relief assumed scale', ref, await driver.render(view), view, {
      relief: RELIEF,
      pixelsPerUnit: { x: assumed, y: assumed },
    });
  });
});

// The reference images of tilted views take seconds each: the harness finds,
// for four samples of every pixel, where the line of sight meets the surface
describe('orthographic view', { timeout: 120_000 }, () => {
  // A full turn is the plain view, but drawn as a surface mesh
  describe('draws the plain image through the surface mesh', () => {
    for (const fixture of ['pattern-ov1', 'pattern-ov0', 'pattern-ov2', 'nan-v2']) {
      for (const [name, view] of Object.entries({
        'finest level': { k: 1, tx: 5.3, ty: 2.7 },
        'magnified 4x across tile borders': { k: 4, tx: -100.2, ty: -90.6 },
        'level max-2': { k: 0.25, tx: 10.4, ty: 6.2 },
      })) {
        it(`${fixture}: ${name}`, async () => {
          const { ref, driver } = await setup(fixture, { relief: true });
          const pixels = await driver.render({ ...view, rotation: 360 });
          await check(
            `mesh ${fixture} ${name}`,
            ref,
            pixels,
            { ...view, rotation: 360 },
            {
              relief: DEFAULT_RELIEF,
              antialias: OPTIONS,
            },
          );
        });
      }
    }
  });

  describe('turns the map', () => {
    for (const rotation of [90, 180, 37]) {
      it(`by ${rotation} degrees`, async () => {
        const { ref, driver } = await setup('pattern-ov1');
        // Keep the middle of the map in the middle of the canvas
        const view = orbit(
          { k: 1.5, tx: -12.5, ty: 5, rotation: 0, tilt: 0 },
          rotation,
          0,
          WIDTH / 2,
          HEIGHT / 2,
        );
        await check(`turned ${rotation}`, ref, await driver.render(view), view, {
          antialias: OPTIONS,
        });
      });
    }
  });

  describe('tilts the map', () => {
    // Heights are exaggerated so that the surface clearly leaves its plane:
    // the pattern is 1 µm high and 75 µm wide
    // Views are magnified enough for a level pixel to cover more than a
    // screen pixel also along the tilt, or little could be checked
    const cases: [string, string, number, number, number, number][] = [
      ['pattern-ov1', 'from the front', 0, 50, 3, 8],
      ['pattern-ov1', 'turned and steep', 30, 70, 4, 8],
      ['pattern-ov2', 'from behind', 200, 40, 3, 20],
      ['pattern-ov1', 'a coarse level', 320, 30, 0.7, 30],
      ['nan-v2', 'with undefined points', 60, 55, 3, 8],
      ['pattern-ov1', 'at true scale', 15, 60, 3, 1],
    ];
    for (const [fixture, name, rotation, tilt, k, exaggeration] of cases) {
      it(`${fixture}: ${name}`, async () => {
        const { ref, driver } = await setup(fixture, { verticalExaggeration: exaggeration });
        const fit = { k, tx: (WIDTH - k * 150) / 2, ty: (HEIGHT - k * 100) / 2 };
        const view = orbit({ ...fit, rotation: 0, tilt: 0 }, rotation, tilt, WIDTH / 2, HEIGHT / 2);
        const pixels = await driver.render(view);
        const expected = expectedImage(ref, view, WIDTH, HEIGHT, {
          verticalExaggeration: exaggeration,
          antialias: OPTIONS,
        });
        const result = compare(pixels, expected, WIDTH, OPTIONS);
        if (result.mismatches > 0) {
          await writeDiagnostics(
            `tilted ${fixture} ${name}`,
            pixels,
            expected,
            WIDTH,
            HEIGHT,
            OPTIONS,
          );
        }
        expect(result.mismatches, formatComparison(result)).toBe(0);
        // Much of the canvas is checked and shows the map
        const shown = expected.filter((e) => e.kind === 'mean' && e.map).length;
        expect(shown).toBeGreaterThan(k > 1 ? 0.15 * WIDTH * HEIGHT : 100);
      });
    }

    it('with relief shading', async () => {
      const options = { verticalExaggeration: 8, relief: true };
      const { ref, driver } = await setup('pattern-ov1', options);
      const view = orbit({ k: 1, tx: 25, ty: 30, rotation: 0, tilt: 0 }, 20, 45, 100, 80);
      await check('tilted relief', ref, await driver.render(view), view, {
        verticalExaggeration: 8,
        relief: DEFAULT_RELIEF,
        antialias: OPTIONS,
      });
    });

    it('hides what lies behind higher ground', async () => {
      // Seen from a low angle with strong exaggeration, the ridges of the
      // pattern hide the valleys behind them: fewer level pixels show than
      // in the plain view, and the image still matches. The reference
      // image takes a while at this exaggeration.
      const { ref, driver } = await setup('pattern-ov1', { verticalExaggeration: 40 });
      const view = orbit({ k: 4, tx: -200, ty: -120, rotation: 0, tilt: 0 }, 0, 70, 100, 80);
      const pixels = await driver.render(view);
      const expected = expectedImage(ref, view, WIDTH, HEIGHT, {
        verticalExaggeration: 40,
        antialias: OPTIONS,
      });
      const result = compare(pixels, expected, WIDTH, OPTIONS);
      expect(result.mismatches, formatComparison(result)).toBe(0);
      expect(result.checked).toBeGreaterThan(0.2 * WIDTH * HEIGHT);

      // Some points of the surface are hidden: what shows at their place
      // on the canvas is another point, in front of them. On a flat
      // surface every point shows.
      const hidden = () => {
        let n = 0;
        for (let v = 30.5; v < 70; v += 2) {
          for (let u = 50.5; u < 100; u += 2) {
            const value = referenceValue(ref, ref.maxLevel, u, v)!;
            const at = driver.engine.imageToScreen(u, v, value);
            const pick = driver.engine.pick(at.x, at.y);
            if (!pick.sample || Math.hypot(pick.x - u, pick.y - v) > 1) n++;
          }
        }
        return n;
      };
      expect(hidden()).toBeGreaterThan(50);
      driver.engine.setVerticalExaggeration(0);
      expect(hidden()).toBe(0);
    });
  });

  describe('anti-aliasing', () => {
    const tilted = () =>
      orbit({ k: 3, tx: -125, ty: -70, rotation: 0, tilt: 0 }, 30, 55, WIDTH / 2, HEIGHT / 2);

    it('smooths the edges of the surface and the borders between values', async () => {
      const { ref, driver } = await setup('pattern-ov1', { verticalExaggeration: 8 });
      // The whole map, small enough for its edges to show
      const view = orbit({ k: 1.5, tx: -12.5, ty: 5, rotation: 0, tilt: 0 }, 30, 55, 100, 80);
      const pixels = await driver.render(view);
      const expected = expectedImage(ref, view, WIDTH, HEIGHT, {
        verticalExaggeration: 8,
        antialias: OPTIONS,
      });
      const result = compare(pixels, expected, WIDTH, OPTIONS);
      expect(result.mismatches, formatComparison(result)).toBe(0);

      // Pixels on an edge of the surface, where some samples show the map
      // and others the background, are checked and have a colour in between
      const edge = expected.flatMap((e, i) =>
        e.kind === 'mean' && e.mixed && e.map ? [[e, i] as const] : [],
      );
      expect(edge.length).toBeGreaterThan(20);
      const between = edge.filter(([, i]) => {
        const blue = pixels[4 * i + 2];
        // Blue is 128 on the map and 242 behind it
        return blue > 128 + 15 && blue < BACKGROUND[2] - 15;
      });
      expect(between.length).toBeGreaterThan(10);
    });

    it('can be switched off, for whole values in every pixel', async () => {
      const { ref, driver } = await setup('pattern-ov1', {
        verticalExaggeration: 8,
        antialias: false,
      });
      const view = tilted();
      const pixels = await driver.render(view);
      const expected = expectedImage(ref, view, WIDTH, HEIGHT, { verticalExaggeration: 8 });
      const result = compare(pixels, expected, WIDTH, OPTIONS);
      expect(result.mismatches, formatComparison(result)).toBe(0);
      expect(result.checked).toBeGreaterThan(0.3 * WIDTH * HEIGHT);
    });

    it('switches while showing, without re-uploading textures', async () => {
      const { ref, driver } = await setup('pattern-ov1', { verticalExaggeration: 8 });
      const view = tilted();
      await driver.render(view);
      const upload = vi.spyOn(WebGL2RenderingContext.prototype, 'texImage2D');
      const matches = (antialias: boolean) => {
        const expected = expectedImage(ref, view, WIDTH, HEIGHT, {
          verticalExaggeration: 8,
          antialias: antialias ? OPTIONS : undefined,
        });
        return compare(driver!.renderNow(view), expected, WIDTH, OPTIONS);
      };
      try {
        driver.engine.setAntialias(false);
        expect(matches(false).mismatches).toBe(0);
        // The plain image differs from the smoothed one, and the other way round
        expect(matches(true).mismatches).toBeGreaterThan(100);
        driver.engine.setAntialias(true);
        expect(matches(true).mismatches).toBe(0);
        expect(upload).not.toHaveBeenCalled();
      } finally {
        upload.mockRestore();
      }
    });

    it('does not touch the plain view', async () => {
      // Looking straight down, every pixel shows one value: the image is
      // the same with and without
      const view = { k: 1.5, tx: -12.5, ty: 5.25 };
      const images: Uint8Array[] = [];
      for (const antialias of [true, false]) {
        const { ref, driver: d } = await setup('pattern-ov1', { antialias });
        const pixels = await d.render(view);
        await check(`plain antialias ${antialias}`, ref, pixels, view);
        images.push(pixels);
        d.dispose();
        driver = null;
      }
      expect(images[0]).toEqual(images[1]);
    });

    it('follows the size of the canvas and survives the loss of the context', async () => {
      const { ref, driver } = await setup('pattern-ov1', { verticalExaggeration: 8 });
      const check3d = async (width: number, height: number) => {
        const view = orbit({ k: 3, tx: -125, ty: -70, rotation: 0, tilt: 0 }, 30, 55, 60, 45);
        const pixels = await driver.render(view);
        const expected = expectedImage(ref, view, width, height, {
          verticalExaggeration: 8,
          antialias: OPTIONS,
        });
        const result = compare(pixels, expected, width, OPTIONS);
        expect(result.mismatches, formatComparison(result)).toBe(0);
        expect(result.checked).toBeGreaterThan(0.3 * width * height);
      };
      await check3d(WIDTH, HEIGHT);
      driver.canvas.style.width = '120px';
      driver.canvas.style.height = '90px';
      await expect.poll(() => driver.canvas.width).toBe(120);
      await check3d(120, 90);
      await driver.loseContext();
      await check3d(120, 90);
    });
  });

  it('finds the point of the surface under a canvas position', async () => {
    const { ref, driver } = await setup('pattern-ov1', { verticalExaggeration: 8 });
    const view = orbit({ k: 2, tx: -50, ty: -20, rotation: 0, tilt: 0 }, 30, 60, 100, 80);
    await driver.render(view);
    const engine = driver.engine;
    let hits = 0;
    for (let y = 10; y < HEIGHT; y += 20) {
      for (let x = 10; x < WIDTH; x += 20) {
        const pick = engine.pick(x, y);
        if (!pick.sample) continue;
        hits++;
        // The value is that of the level pixel the point lies in
        expect(pick.sample.value).toBeCloseTo(
          referenceValue(ref, ref.maxLevel, pick.x, pick.y)!,
          6,
        );
        // The plane point under the same canvas position at the height of
        // the surface there is the picked point: it lies on the line of sight
        const z = surfaceHeightAt(ref, ref.maxLevel, pick.x, pick.y, 8);
        const { u, v } = unproject(view, x, y, z);
        expect(Math.hypot(u - pick.x, v - pick.y)).toBeLessThan(1e-3);
      }
    }
    expect(hits).toBeGreaterThan(20);
    // Outside the map
    expect(engine.pick(1, 1).sample).toBeNull();
  });

  it('reports the turned view and its footprint', async () => {
    const { driver } = await setup('pattern-ov1');
    const engine = driver.engine;
    expect(engine.isTilted).toBe(false);
    engine.setView(engine.orbitView(90, 60));
    expect(engine.isTilted).toBe(true);
    expect(engine.view.rotation).toBe(90);
    expect(engine.view.tilt).toBe(60);
    // The point at the centre of the canvas stays where it was
    const centre = engine.screenToImage(WIDTH / 2, HEIGHT / 2);
    expect(centre.x).toBeCloseTo(75, 6);
    expect(centre.y).toBeCloseTo(50, 6);
    const back = engine.imageToScreen(centre.x, centre.y);
    expect(back.x).toBeCloseTo(WIDTH / 2, 9);
    expect(back.y).toBeCloseTo(HEIGHT / 2, 9);
    // Everything on the canvas lies within the footprint
    const rect = engine.visibleImageRect();
    for (const [x, y] of [
      [0, 0],
      [WIDTH, HEIGHT],
    ]) {
      const p = engine.screenToImage(x, y);
      expect(p.x).toBeGreaterThanOrEqual(rect.x0 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(rect.x1 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(rect.y0 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(rect.y1 + 1e-9);
    }
    expect(() => engine.setView({ k: 1, x: 0, y: 0, tilt: 80 })).toThrow('Invalid view');
    expect(() => engine.setVerticalExaggeration(-1)).toThrow('exaggeration');
    // The limit of the tilt
    expect(engine.orbitView(0, 89).tilt).toBe(75);
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

// The same pyramids as zipped OME-Zarr files, read with range requests: the
// tiles, assembled from chunks with the overlap of the NetCDF pyramid, must
// draw the same pictures
describe('zipped OME-Zarr pyramid', () => {
  async function setupZarr(name: string, options: Omit<DriverOptions, 'width' | 'height'> = {}) {
    const ref = await loadReference(name);
    const source = new ZarrSource(`${fixtureUrl(name)}pyramid.ozx`, { overlap: ref.overlap });
    driver = await createDriver(ref, { width: WIDTH, height: HEIGHT, source, ...options });
    return { ref, driver };
  }

  for (const fixture of ['pattern-ov1', 'pattern-ov0', 'pattern-ov2', 'nan-v2']) {
    describe(fixture, () => {
      for (const [name, view] of Object.entries(VIEWS)) {
        it(name, async () => {
          const { ref, driver } = await setupZarr(fixture);
          await check(`zarr ${fixture} ${name}`, ref, await driver.render(view), view);
        });
      }
    });
  }

  it('is read from a URL ending in .ozx', async () => {
    const ref = await loadReference('pattern-ov1');
    const engine = await ZoomEngine.create(document.createElement('canvas'), {
      source: `${fixtureUrl('pattern-ov1')}pyramid.ozx`,
    });
    expect(engine.config.descriptor.format).toBe('zarr');
    expect(engine.config.descriptor.size).toEqual({
      Width: ref.imageWidth,
      Height: ref.imageHeight,
    });
    engine.dispose();
  });

  it('draws the coarsest stored level when zoomed out further', async () => {
    const { driver } = await setupZarr('pattern-ov1');
    // Level 4 would match k = 1/16, but levels below 5 are not stored. The
    // map is too small on screen to compare pixels with the reference.
    const pixels = await driver.render({ k: 1 / 16, tx: 30, ty: 20 });
    expect(driver.engine.level).toBe(5);
    let map = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.subarray(i, i + 3);
      if (r !== BACKGROUND[0] || g !== BACKGROUND[1] || b !== BACKGROUND[2]) map++;
    }
    // About 150 / 16 x 100 / 16 pixels
    expect(map).toBeGreaterThan(40);
  });

  describe('relief across tile borders', () => {
    for (const fixture of ['pattern-ov1', 'pattern-ov2']) {
      it(fixture, async () => {
        const { ref, driver } = await setupZarr(fixture, { relief: true });
        const view = { k: 4, tx: -100.2, ty: -90.6 };
        await check(`zarr relief ${fixture}`, ref, await driver.render(view), view, {
          relief: DEFAULT_RELIEF,
        });
      });
    }
  });
});
