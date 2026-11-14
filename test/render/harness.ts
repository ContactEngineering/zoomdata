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
 * - With relief shading, that colour is multiplied by a brightness factor
 *   that follows from the slope of the surface at that level pixel: the
 *   central difference of the reference heights, divided by the pixel size.
 *
 * - With a rotation or a tilt, the map shows as a surface in an orthographic
 *   view (see `locate` and `surfaceHeight`); each point of the surface has
 *   the colour of the level pixel it lies in.
 *
 * Pixel centres within `edgeTolerance` (in screen pixels) of a texel border
 * or the image border are not checked, since either side is correct there.
 */
import { commands } from 'vitest/browser';
import { reliefFactor, type ReliefOptions } from '../../src/relief';

export interface View {
  k: number;
  tx: number;
  ty: number;
  /** Rotation and tilt of the orthographic view in degrees (default 0) */
  rotation?: number;
  tilt?: number;
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
  tileSize: number;
  overlap: number;
  /** Image pixels per unit of the heights (the fixtures' heights are in µm) */
  pixelsPerUnit: { x: number; y: number };
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
    tileSize: descriptor.Image.TileSize,
    overlap: descriptor.Image.Overlap,
    pixelsPerUnit: {
      x: 1e-6 * descriptor.Image.PixelsPerMeter.Width,
      y: 1e-6 * descriptor.Image.PixelsPerMeter.Height,
    },
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
  | { kind: 'value'; t: number; value: number; shade?: number };

export interface ExpectOptions {
  /** Colour range in physical units (default: the descriptor's ColorbarRange) */
  colorRange?: [number, number];
  /** Force the level, e.g. for fallback rendering */
  level?: number;
  /** Distance from a texel border below which a pixel is not checked */
  edgeTolerance?: number;
  /** Relief shading the image is drawn with */
  relief?: Required<ReliefOptions>;
  /** Image pixels per unit of the heights, if not the reference's */
  pixelsPerUnit?: { x: number; y: number };
  /** Vertical exaggeration of the surface in the tilted view (default 1) */
  verticalExaggeration?: number;
}

/**
 * Slope of the reference surface at a pixel of a level along one axis: the
 * central difference of the heights, or a one-sided difference at the edge
 * of the map and next to undefined points.
 */
function referenceSlope(
  ref: Reference,
  level: number,
  i: number,
  j: number,
  axis: 'x' | 'y',
  pixelsPerUnit: number,
): number {
  const l = ref.levels[level];
  const stride = 2 ** (ref.maxLevel - level);
  const at = (d: number) => {
    const ii = axis === 'x' ? Math.min(l.width - 1, Math.max(0, i + d)) : i;
    const jj = axis === 'y' ? Math.min(l.height - 1, Math.max(0, j + d)) : j;
    const h = l.data[jj * l.width + ii];
    // Next to an undefined point the difference starts at the pixel itself
    return Number.isNaN(h)
      ? { h: l.data[j * l.width + i], p: axis === 'x' ? i : j }
      : { h, p: axis === 'x' ? ii : jj };
  };
  const a = at(-1);
  const b = at(1);
  if (b.p === a.p) return 0;
  // Heights in units, distance in image pixels
  return ((b.h - a.h) * pixelsPerUnit) / ((b.p - a.p) * stride);
}

/**
 * Height of the surface that the tilted view draws at an image position, in
 * image pixels above the reference plane. The surface has a vertex at the
 * centre of every pixel of the level, at the height of its value, or in the
 * reference plane if the value is undefined. Each square between four
 * centres is split into two triangles along the diagonal from its top right
 * to its bottom left corner. Beyond the outermost centres the surface
 * continues at their heights to the border of the map.
 */
function surfaceHeight(
  ref: Reference,
  level: number,
  u: number,
  v: number,
  scale: number,
  reference: number,
): number {
  const l = ref.levels[level];
  const s = 2 ** (ref.maxLevel - level);
  const fx = u / s - 0.5;
  const fy = v / s - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const wx = fx - i0;
  const wy = fy - j0;
  const z = (di: number, dj: number) => {
    const i = Math.min(l.width - 1, Math.max(0, i0 + di));
    const j = Math.min(l.height - 1, Math.max(0, j0 + dj));
    const h = l.data[j * l.width + i];
    return Number.isNaN(h) ? 0 : (h - reference) * scale;
  };
  return wx + wy <= 1
    ? z(0, 0) + wx * (z(1, 0) - z(0, 0)) + wy * (z(0, 1) - z(0, 0))
    : z(1, 1) + (1 - wx) * (z(0, 1) - z(1, 1)) + (1 - wy) * (z(1, 0) - z(1, 1));
}

/** Scale and reference of the heights of the tilted view */
function heightScale(ref: Reference, options: ExpectOptions) {
  const ppu = options.pixelsPerUnit ?? ref.pixelsPerUnit;
  const scale = ppu.x * (options.verticalExaggeration ?? 1);
  const { Minimum: min, Maximum: max } = ref.colorbarRange;
  const reference = (min + max) / 2;
  return { scale, reference, zMin: (min - reference) * scale, zMax: (max - reference) * scale };
}

/** Height of the drawn surface at an image position, in image pixels */
export function surfaceHeightAt(
  ref: Reference,
  level: number,
  u: number,
  v: number,
  verticalExaggeration = 1,
): number {
  const { scale, reference } = heightScale(ref, { verticalExaggeration });
  return surfaceHeight(ref, level, u, v, scale, reference);
}

/**
 * Image position of the point of the map that shows at a screen position,
 * or null if none does.
 *
 * In the tilted view the surface is a sheet without sides, seen from above
 * or below: the point that shows is the first where the line of sight,
 * followed from the viewer, crosses it.
 */
function locate(
  ref: Reference,
  view: View,
  level: number,
  sx: number,
  sy: number,
  options: ExpectOptions,
): { u: number; v: number } | null {
  const rotation = ((view.rotation ?? 0) * Math.PI) / 180;
  const tilt = ((view.tilt ?? 0) * Math.PI) / 180;
  const c = Math.cos(rotation);
  const sn = Math.sin(rotation);
  const xr = (sx - view.tx) / view.k;
  const ys = (sy - view.ty) / view.k;
  // Point of the line of sight at height z
  const at = (z: number) => {
    const yr = (ys + z * Math.sin(tilt)) / Math.cos(tilt);
    return { u: xr * c + yr * sn, v: -xr * sn + yr * c };
  };
  const inside = (p: { u: number; v: number }) =>
    p.u >= 0 && p.v >= 0 && p.u <= ref.imageWidth && p.v <= ref.imageHeight;
  if (tilt === 0) {
    const p = at(0);
    return inside(p) ? p : null;
  }

  const { scale, reference, zMin, zMax } = heightScale(ref, options);
  const stride = 2 ** (ref.maxLevel - level);
  // Height of the line of sight above the surface
  const above = (z: number) => {
    const p = at(z);
    return z - surfaceHeight(ref, level, p.u, p.v, scale, reference);
  };
  const margin = 1e-6 * (zMax - zMin) + 1e-9;
  const top = zMax + margin;
  const bottom = zMin - margin;

  // Within a triangle of the surface, the height of the line above it
  // changes linearly along the line. The line passes from one triangle to
  // the next where one of fx, fy and fx + fy is an integer, with (fx, fy)
  // the position in units of level pixels counted from the centre of the
  // first; and it enters and leaves the map at its borders. Checking the
  // sign at all these heights finds every crossing.
  const p0 = at(0);
  const p1 = at(1);
  const lines: [number, number, number[]][] = [];
  const integers = (f0: number, df: number): [number, number, number[]] => {
    const a = f0 + df * top;
    const b = f0 + df * bottom;
    const values: number[] = [];
    for (let n = Math.ceil(Math.min(a, b)); n <= Math.max(a, b); n++) values.push(n);
    return [f0, df, values];
  };
  const fx0 = p0.u / stride - 0.5;
  const fy0 = p0.v / stride - 0.5;
  const dfx = (p1.u - p0.u) / stride;
  const dfy = (p1.v - p0.v) / stride;
  lines.push(integers(fx0, dfx), integers(fy0, dfy), integers(fx0 + fy0, dfx + dfy));
  lines.push([p0.u, p1.u - p0.u, [0, ref.imageWidth]], [p0.v, p1.v - p0.v, [0, ref.imageHeight]]);
  const heights = [top, bottom];
  for (const [f0, df, values] of lines) {
    if (df === 0) continue;
    for (const value of values) {
      const z = (value - f0) / df;
      if (z < top && z > bottom) heights.push(z);
    }
  }
  heights.sort((a, b) => b - a);

  for (let n = 1; n < heights.length; n++) {
    const hi = heights[n - 1];
    const lo = heights[n];
    if (hi - lo < 1e-12 || !inside(at((hi + lo) / 2))) continue;
    const fHi = above(hi);
    const fLo = above(lo);
    if (fHi > 0 !== fLo > 0) return at(hi - ((hi - lo) * fHi) / (fHi - fLo));
  }
  return null;
}

/** What shows at a point of the map, before relief shading */
function expectedAt(
  ref: Reference,
  level: number,
  hit: { u: number; v: number } | null,
): { kind: 'background' } | { kind: 'nodata' } | { kind: 'value'; value: number; cell: string } {
  const value = hit ? referenceValue(ref, level, hit.u, hit.v) : undefined;
  if (!hit || value === undefined) return { kind: 'background' };
  if (Number.isNaN(value)) return { kind: 'nodata' };
  const s = 2 ** (ref.maxLevel - level);
  return { kind: 'value', value, cell: `${Math.floor(hit.u / s)},${Math.floor(hit.v / s)}` };
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
  const turned = Boolean(view.rotation) || Boolean(view.tilt);
  // Distances along the view direction are foreshortened in the tilted view
  const tol = (options.edgeTolerance ?? 0.05) / Math.cos(((view.tilt ?? 0) * Math.PI) / 180);
  const s = 2 ** (ref.maxLevel - level);
  const out: Expected[] = new Array(width * height);
  // Distance of a coordinate from the nearest border between level pixels
  // or from the border of the map, in screen pixels
  const fromBorder = (x: number, size: number) =>
    view.k * Math.min(Math.abs(x - Math.round(x / s) * s), Math.abs(x - size));
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const hit = locate(ref, view, level, px + 0.5, py + 0.5, options);
      const e = expectedAt(ref, level, hit);
      // Not checked: pixels whose centre lies on a border between level
      // pixels or on the border of the map, where either side is correct.
      // In the turned view such borders run at any angle, and the surface
      // has edges where it hides itself: a pixel is checked only if the
      // same thing shows a little to each side of its centre.
      let skip: boolean;
      if (!turned) {
        const u = (px + 0.5 - view.tx) / view.k;
        const v = (py + 0.5 - view.ty) / view.k;
        skip = fromBorder(u, ref.imageWidth) < tol || fromBorder(v, ref.imageHeight) < tol;
      } else {
        skip =
          hit !== null &&
          (fromBorder(hit.u, ref.imageWidth) < tol || fromBorder(hit.v, ref.imageHeight) < tol);
        const d = 0.3;
        for (const [dx, dy] of [
          [-d, -d],
          [d, -d],
          [-d, d],
          [d, d],
          [-d, 0],
          [d, 0],
          [0, -d],
          [0, d],
        ]) {
          if (skip) break;
          const other = expectedAt(
            ref,
            level,
            locate(ref, view, level, px + 0.5 + dx, py + 0.5 + dy, options),
          );
          skip =
            other.kind !== e.kind ||
            (other.kind === 'value' && e.kind === 'value' && other.cell !== e.cell);
        }
      }
      if (skip) {
        out[py * width + px] = { kind: 'skip' };
        continue;
      }
      if (e.kind !== 'value' || !hit) {
        out[py * width + px] = { kind: e.kind === 'value' ? 'skip' : e.kind };
        continue;
      }
      const { value } = e;
      const t = cmax > cmin ? Math.min(1, Math.max(0, (value - cmin) / (cmax - cmin))) : 0;
      const expected: Expected = { kind: 'value', t, value };
      if (options.relief) {
        const i = Math.floor(hit.u / s);
        const j = Math.floor(hit.v / s);
        // Without overlap, tiles do not hold their neighbours' values, so
        // slopes at tile borders are one-sided; these are not checked
        const T = ref.tileSize;
        if (ref.overlap === 0 && [i % T, j % T].some((r) => r === 0 || r === T - 1)) {
          out[py * width + px] = { kind: 'skip' };
          continue;
        }
        const ppu = options.pixelsPerUnit ?? ref.pixelsPerUnit;
        expected.shade = reliefFactor(
          referenceSlope(ref, level, i, j, 'x', ppu.x),
          referenceSlope(ref, level, i, j, 'y', ppu.y),
          options.relief,
        );
      }
      out[py * width + px] = expected;
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
      return (
        `value ${e.value.toPrecision(6)} (R=${(255 * e.t).toFixed(1)})` +
        (e.shade === undefined ? '' : ` × ${e.shade.toFixed(3)}`)
      );
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
    } else if (e.shade === undefined) {
      const r = 255 * e.t;
      ok =
        Math.abs(actual[0] - r) <= valueTol &&
        Math.abs(actual[0] + actual[1] - 255) <= colorTol &&
        Math.abs(actual[2] - 128) <= colorTol;
    } else {
      // The palette colour (r, 255 - r, 128) times the brightness factor
      const r = 255 * e.t;
      const f = e.shade;
      const tol = valueTol * f + colorTol;
      ok = [r, 255 - r, 128].every((c, k) => Math.abs(actual[k] - Math.min(255, c * f)) <= tol);
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
      const f = e.shade ?? 1;
      c = [r * f, (255 - r) * f, 128 * f];
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
