/**
 * Drives the viewer for the render tests. This is the only part of the
 * harness that knows the viewer's API; it renders a view synchronously after
 * all tiles it needs have loaded and returns the canvas pixels.
 */
import { ZoomData } from '../../src/ZoomData';
import type { RGB, Reference, View } from './harness';
import { fixtureUrl, testPalette } from './harness';

/**
 * The current renderer does not draw the reference image: it quantises
 * values to 8 bits and filters them linearly, stretches partial tiles at the
 * right and bottom edges to a full tile, and misplaces fallback tiles because
 * it ignores their overlap. Undefined points and format version 2 are not
 * supported. All render tests are expected to fail until this is fixed.
 */
export const KNOWN_BROKEN = true;

/** Colour the canvas is cleared to (0.95 grey) */
export const BACKGROUND: RGB = [242, 242, 242];
/** Undefined points; the current renderer has no no-data colour */
export const NO_DATA: RGB = [255, 0, 255];

export interface Driver {
  canvas: HTMLCanvasElement;
  /** Render the view once all tiles it requests are loaded */
  render(view: View): Promise<Uint8Array>;
  /** Render the view with whatever is cached, without waiting */
  renderNow(view: View): Uint8Array;
  setColorRange(min: number, max: number): void;
  /** Delay fetches of tiles whose URL matches; returns a release function */
  blockTiles(pattern: RegExp): () => void;
  dispose(): void;
}

// Internal state used to render synchronously and to wait for tiles
interface ZoomDataInternals {
  zoomLevel: number;
  xPos: number;
  yPos: number;
  render(): void;
  tiledImage: { tileCache: { values(): IterableIterator<{ getState(): string }> } };
}

const blocked: { pattern: RegExp; release: Promise<void> }[] = [];
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  for (const b of blocked) {
    if (b.pattern.test(url)) await b.release;
  }
  return originalFetch(input, init);
};

function readPixels(canvas: HTMLCanvasElement): Uint8Array {
  const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))!;
  const w = canvas.width;
  const h = canvas.height;
  const raw = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  // WebGL rows are bottom-up
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    out.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  }
  return out;
}

export async function createDriver(
  ref: Reference,
  width = 200,
  height = 160,
  colorRange?: [number, number],
): Promise<Driver> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);

  // The current viewer maps tile values (normalised to [0, 1] for format
  // version 1) rather than physical values to colours
  const { Minimum: mn, Maximum: mx } = ref.colorbarRange;
  const toNorm = (h: number) => (mx > mn ? (h - mn) / (mx - mn) : h - mn);
  const [cmin, cmax] = colorRange ?? [mn, mx];

  const viewer = new ZoomData({
    rootUrl: fixtureUrl(ref.name),
    colorPalette: testPalette(),
    minValue: toNorm(cmin),
    maxValue: toNorm(cmax),
  });
  await viewer.start(canvas);
  const internals = viewer as unknown as ZoomDataInternals;

  const setView = (view: View) => {
    internals.zoomLevel = ref.maxLevel + Math.log2(view.k);
    internals.xPos = view.tx;
    internals.yPos = view.ty;
  };

  const loading = () =>
    [...internals.tiledImage.tileCache.values()].some((t) => t.getState() === 'loading');

  return {
    canvas,
    async render(view) {
      setView(view);
      internals.render();
      for (let i = 0; i < 200 && loading(); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      internals.render();
      return readPixels(canvas);
    },
    renderNow(view) {
      setView(view);
      internals.render();
      return readPixels(canvas);
    },
    setColorRange(min, max) {
      viewer.setColorRange(toNorm(min), toNorm(max));
    },
    blockTiles(pattern) {
      let release!: () => void;
      const entry = { pattern, release: new Promise<void>((r) => (release = r)) };
      blocked.push(entry);
      return () => {
        blocked.splice(blocked.indexOf(entry), 1);
        release();
      };
    },
    dispose() {
      viewer.stop();
      canvas.remove();
    },
  };
}
