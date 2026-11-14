/**
 * Drives the viewer for the render tests. This is the only part of the
 * harness that knows the viewer's API; it renders a view synchronously after
 * all tiles it needs have loaded and returns the canvas pixels.
 */
import type { Sample } from '../../src/sampling';
import { StaticTileSource, type TileSource } from '../../src/TileSource';
import { ZoomData } from '../../src/ZoomData';
import type { RGB, Reference, View } from './harness';
import { fixtureUrl, testPalette } from './harness';

/** Set while the renderer is known not to draw the reference image */
export const KNOWN_BROKEN = false;

/** Colour the canvas is cleared to (0.95 grey) */
export const BACKGROUND: RGB = [242, 242, 242];
/** Undefined points */
export const NO_DATA: RGB = [255, 0, 255];

export interface Driver {
  canvas: HTMLCanvasElement;
  /** Render the view once all tiles it requests are loaded */
  render(view: View): Promise<Uint8Array>;
  /** Render the view with whatever is cached, without waiting */
  renderNow(view: View): Uint8Array;
  setColorRange(min: number, max: number): void;
  /** Value at an image position from the tiles in memory */
  sampleAt(x: number, y: number): Sample | null;
  /** Number of tile fetches so far */
  tileFetches(): number;
  /** Lose the WebGL context and wait until it is restored */
  loseContext(): Promise<void>;
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
let tileFetches = 0;
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/dzdata_files/')) tileFetches++;
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

export interface DriverOptions {
  width?: number;
  height?: number;
  colorRange?: [number, number];
  source?: TileSource;
}

export async function createDriver(ref: Reference, options: DriverOptions = {}): Promise<Driver> {
  const { width = 200, height = 160, colorRange } = options;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);

  const viewer = new ZoomData({
    source: options.source ?? new StaticTileSource(fixtureUrl(ref.name)),
    colorPalette: testPalette(),
    minValue: colorRange?.[0],
    maxValue: colorRange?.[1],
    noDataColor: (NO_DATA[0] | (NO_DATA[1] << 8) | (NO_DATA[2] << 16) | (255 << 24)) >>> 0,
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
      viewer.setColorRange(min, max);
    },
    sampleAt: (x, y) => viewer.sampleAt(x, y),
    tileFetches: () => tileFetches,
    async loseContext() {
      const gl = canvas.getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_lose_context')!;
      const lost = new Promise((r) =>
        canvas.addEventListener('webglcontextlost', r, { once: true }),
      );
      ext.loseContext();
      await lost;
      // Restoring from within the task that delivered the event is ignored
      await new Promise((r) => setTimeout(r, 0));
      const restored = new Promise((r) =>
        canvas.addEventListener('webglcontextrestored', r, { once: true }),
      );
      ext.restoreContext();
      await restored;
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
