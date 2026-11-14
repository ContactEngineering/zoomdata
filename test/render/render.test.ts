import { afterEach, describe, expect, it } from 'vitest';
import { BACKGROUND, KNOWN_BROKEN, NO_DATA, createDriver, type Driver } from './driver';
import {
  compare,
  expectedImage,
  formatComparison,
  loadReference,
  writeDiagnostics,
  type ExpectOptions,
  type Reference,
  type View,
} from './harness';

// Expected failures are reported as passing, unexpected passes as failing
const test = KNOWN_BROKEN ? it.fails : it;

const WIDTH = 200;
const HEIGHT = 160;
const OPTIONS = { background: BACKGROUND, noData: NO_DATA };

let driver: Driver | null = null;
afterEach(() => {
  driver?.dispose();
  driver = null;
});

async function setup(name: string, colorRange?: [number, number]) {
  const ref = await loadReference(name);
  driver = await createDriver(ref, WIDTH, HEIGHT, colorRange);
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
      test(name, async () => {
        const { ref, driver } = await setup(fixture);
        await check(`${fixture} ${name}`, ref, await driver.render(view), view);
      });
    }

    test('falls back to a cached coarser level while tiles load', async () => {
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

describe('colour range', () => {
  test('maps a narrower range and clamps outside it', async () => {
    const { ref, driver } = await setup('pattern-ov1');
    const { Minimum: mn, Maximum: mx } = ref.colorbarRange;
    const range: [number, number] = [mn + 0.25 * (mx - mn), mn + 0.75 * (mx - mn)];
    const view = { k: 1, tx: 5, ty: 3 };
    await driver.render(view);
    driver.setColorRange(...range);
    await check('colour range', ref, await driver.render(view), view, { colorRange: range });
  });
});

describe('undefined points and format version 2', () => {
  for (const fixture of ['nan-v1', 'nan-v2']) {
    for (const [name, view] of Object.entries({
      'finest level': { k: 1, tx: 5, ty: 3 },
      'level max-2': { k: 0.25, tx: 10.4, ty: 6.2 },
    })) {
      test(`${fixture}: ${name}`, async () => {
        const { ref, driver } = await setup(fixture);
        await check(`${fixture} ${name}`, ref, await driver.render(view), view);
      });
    }
  }

  test('flat-v2: constant map', async () => {
    const { ref, driver } = await setup('flat-v2', [0, 1]);
    const view = { k: 2, tx: 7, ty: 5 };
    await check('flat-v2', ref, await driver.render(view), view, { colorRange: [0, 1] });
  });
});
