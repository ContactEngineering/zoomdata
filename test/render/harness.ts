/**
 * Render test harness: renders fixture pyramids in a real browser (WebGL via
 * SwiftShader) and compares every screen pixel with an image computed from
 * the reference levels in `test/fixtures/<name>/reference`.
 *
 * The expected image follows these rules:
 *
 * - The view transform is `screen = k * image + t`, in canvas pixels.
 * - The level is `clamp(round(maxLevel + log2(k)), 0, maxLevel)`, unless a
 *   test forces another one (fallback rendering); its stride is
 *   `s = 2 ** (maxLevel - level)` image pixels.
 * - The screen pixel centred at `p + 0.5` shows level pixel
 *   `floor((p + 0.5 - t) / (k * s))` (nearest neighbour). Pixels whose centre
 *   lies outside `[0, Width) x [0, Height)` of the image show the background.
 * - Undefined values (NaN) show the no-data colour.
 * - Values are mapped linearly from the colour range to the test palette,
 *   whose entry i is RGB (i, 255 - i, 128), so the red channel encodes the
 *   value and blue tells data from background.
 *
 * Pixel centres within `edgeTolerance` (in screen pixels) of a texel border
 * or the image border are not checked, since either side is correct there.
 */
import { commands } from 'vitest/browser';

export interface View {
  k: number;
  tx: number;
  ty: number;
}

interface ReferenceLevel {
  width: number;
  height: number;
  data: Float64Array;
}

export interface Reference {
  name: string;
  maxLevel: number;
  levels: ReferenceLevel[];
  imageWidth: number;
  imageHeight: number;
  colorbarRange: { Minimum: number; Maximum: number };
}

export type RGB = [number, number, number];

const FIXTURE_ROOT = '/test/fixtures/';

export function fixtureUrl(name: string): string {
  return `${FIXTURE_ROOT}${name}/`;
}

/** Palette with entry i = RGB(i, 255 - i, 128), opaque, as 32-bit ABGR */
export function testPalette(n = 256): number[] {
  const palette: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = Math.round((i * 255) / (n - 1));
    palette.push((v | ((255 - v) << 8) | (128 << 16) | (255 << 24)) >>> 0);
  }
  return palette;
}

export async function loadReference(name: string): Promise<Reference> {
  const root = fixtureUrl(name);
  const [descriptor, index, buffer] = await Promise.all([
    fetch(`${root}dzdata.json`).then((r) => r.json()),
    fetch(`${root}reference/levels.json`).then((r) => r.json()),
    fetch(`${root}reference/levels.f64`).then((r) => r.arrayBuffer()),
  ]);
  const levels: ReferenceLevel[] = [];
  for (let level = 0; level <= index.maxLevel; level++) {
    const { width, height, offset } = index.levels[level];
    levels.push({ width, height, data: new Float64Array(buffer, offset, width * height) });
  }
  return {
    name,
    maxLevel: index.maxLevel,
    levels,
    imageWidth: descriptor.Image.Size.Width,
    imageHeight: descriptor.Image.Size.Height,
    colorbarRange: descriptor.Image.ColorbarRange,
  };
}

/** Value at image position (u, v) on the given level, or undefined outside */
export function referenceValue(
  ref: Reference,
  level: number,
  u: number,
  v: number,
): number | undefined {
  if (u < 0 || v < 0 || u >= ref.imageWidth || v >= ref.imageHeight) return undefined;
  const s = 2 ** (ref.maxLevel - level);
  const l = ref.levels[level];
  const i = Math.floor(u / s);
  const j = Math.floor(v / s);
  return l.data[j * l.width + i];
}

function levelForView(ref: Reference, view: View): number {
  return Math.max(0, Math.min(ref.maxLevel, Math.round(ref.maxLevel + Math.log2(view.k))));
}

export type Expected =
  | { kind: 'skip' }
  | { kind: 'background' }
  | { kind: 'nodata' }
  | { kind: 'value'; t: number; value: number };

export interface ExpectOptions {
  /** Colour range in physical units (default: the descriptor's ColorbarRange) */
  colorRange?: [number, number];
  /** Force the level, e.g. for fallback rendering */
  level?: number;
  /** Distance from a texel border below which a pixel is not checked */
  edgeTolerance?: number;
}

function nearBorder(x: number, period: number, tol: number): boolean {
  const r = x - Math.round(x / period) * period;
  return Math.abs(r) < tol;
}

export function expectedImage(
  ref: Reference,
  view: View,
  width: number,
  height: number,
  options: ExpectOptions = {},
): Expected[] {
  const level = options.level ?? levelForView(ref, view);
  const [cmin, cmax] = options.colorRange ?? [ref.colorbarRange.Minimum, ref.colorbarRange.Maximum];
  const tol = options.edgeTolerance ?? 0.05;
  const s = 2 ** (ref.maxLevel - level);
  const texel = view.k * s; // screen pixels per texel
  const out: Expected[] = new Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const sx = px + 0.5 - view.tx;
      const sy = py + 0.5 - view.ty;
      const u = sx / view.k;
      const v = sy / view.k;
      const imgW = ref.imageWidth * view.k;
      const imgH = ref.imageHeight * view.k;
      if (
        nearBorder(sx, texel, tol) ||
        nearBorder(sy, texel, tol) ||
        Math.abs(sx - imgW) < tol ||
        Math.abs(sy - imgH) < tol
      ) {
        out[py * width + px] = { kind: 'skip' };
        continue;
      }
      const value = referenceValue(ref, level, u, v);
      if (value === undefined) {
        out[py * width + px] = { kind: 'background' };
      } else if (Number.isNaN(value)) {
        out[py * width + px] = { kind: 'nodata' };
      } else {
        const t = cmax > cmin ? Math.min(1, Math.max(0, (value - cmin) / (cmax - cmin))) : 0;
        out[py * width + px] = { kind: 'value', t, value };
      }
    }
  }
  return out;
}

export interface CompareOptions {
  background: RGB;
  noData: RGB;
  /** Tolerance on the red channel against 255 * t */
  valueTolerance?: number;
  /** Tolerance on each channel for background and no-data */
  colorTolerance?: number;
}

interface Mismatch {
  x: number;
  y: number;
  expected: string;
  actual: RGB;
}

export interface Comparison {
  checked: number;
  mismatches: number;
  examples: Mismatch[];
}

function describe(e: Expected): string {
  switch (e.kind) {
    case 'value':
      return `value ${e.value.toPrecision(6)} (R=${(255 * e.t).toFixed(1)})`;
    default:
      return e.kind;
  }
}

function close(a: RGB, b: RGB, tol: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
  );
}

/** Compare top-down RGBA pixels with the expected image */
export function compare(
  pixels: Uint8Array,
  expected: Expected[],
  width: number,
  options: CompareOptions,
): Comparison {
  const valueTol = options.valueTolerance ?? 1.5;
  const colorTol = options.colorTolerance ?? 2;
  const result: Comparison = { checked: 0, mismatches: 0, examples: [] };
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    if (e.kind === 'skip') continue;
    result.checked++;
    const actual: RGB = [pixels[4 * i], pixels[4 * i + 1], pixels[4 * i + 2]];
    let ok: boolean;
    if (e.kind === 'background') {
      ok = close(actual, options.background, colorTol);
    } else if (e.kind === 'nodata') {
      ok = close(actual, options.noData, colorTol);
    } else {
      const r = 255 * e.t;
      ok =
        Math.abs(actual[0] - r) <= valueTol &&
        Math.abs(actual[0] + actual[1] - 255) <= colorTol &&
        Math.abs(actual[2] - 128) <= colorTol;
    }
    if (!ok) {
      result.mismatches++;
      if (result.examples.length < 8) {
        result.examples.push({
          x: i % width,
          y: Math.floor(i / width),
          expected: describe(e),
          actual,
        });
      }
    }
  }
  return result;
}

/** Expected image as top-down RGBA, for writing diagnostics */
function expectedPixels(
  expected: Expected[],
  options: CompareOptions,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(expected.length * 4);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    let c: RGB;
    if (e.kind === 'value') {
      const r = Math.round(255 * e.t);
      c = [r, 255 - r, 128];
    } else if (e.kind === 'background') {
      c = options.background;
    } else if (e.kind === 'nodata') {
      c = options.noData;
    } else {
      c = [0, 255, 255];
    }
    out.set([...c, 255], 4 * i);
  }
  return out;
}

async function writePng(
  path: string,
  rgba: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  await commands.writeFile(path, base64, { encoding: 'base64' });
}

/**
 * Write actual and expected images to `test/render/__output__/` so a failure
 * can be inspected. Mismatching pixels are magenta in the diff image.
 */
export async function writeDiagnostics(
  label: string,
  pixels: Uint8Array,
  expected: Expected[],
  width: number,
  height: number,
  options: CompareOptions,
): Promise<void> {
  const base = `test/render/__output__/${label.replace(/[^a-zA-Z0-9_.-]+/g, '_')}`;
  const exp = expectedPixels(expected, options);
  const diff = new Uint8ClampedArray(pixels);
  const cmp = compare(pixels, expected, width, options);
  if (cmp.mismatches > 0) {
    // Mark mismatches; recompute per pixel to find them
    for (let i = 0; i < expected.length; i++) {
      const single = compare(pixels.subarray(4 * i, 4 * i + 4), [expected[i]], 1, options);
      if (single.mismatches) diff.set([255, 0, 255, 255], 4 * i);
    }
  }
  await writePng(`${base}-actual.png`, new Uint8ClampedArray(pixels), width, height);
  await writePng(`${base}-expected.png`, exp, width, height);
  await writePng(`${base}-diff.png`, diff, width, height);
}

export function formatComparison(c: Comparison): string {
  const lines = [`${c.mismatches} of ${c.checked} pixels differ`];
  for (const m of c.examples) {
    lines.push(`  (${m.x}, ${m.y}): expected ${m.expected}, got RGB(${m.actual.join(', ')})`);
  }
  return lines.join('\n');
}
