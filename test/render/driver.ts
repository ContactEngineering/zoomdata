/**
 * Drives the engine for the render tests. This is the only part of the
 * harness that knows the engine's API; it renders a view synchronously after
 * all tiles it needs have loaded and returns the canvas pixels.
 */
import type { ReliefOptions } from '../../src/relief';
import type { Sample } from '../../src/sampling';
import { StaticTileSource, type TileSource } from '../../src/TileSource';
import { ZoomEngine } from '../../src/ZoomEngine';
import type { RGB, Reference, View } from './harness';
import { fixtureUrl, testPalette } from './harness';

/** Colour the canvas is cleared to (0.95 grey) */
export const BACKGROUND: RGB = [242, 242, 242];
/** Undefined points */
export const NO_DATA: RGB = [255, 0, 255];

export interface Driver {
  canvas: HTMLCanvasElement;
  engine: ZoomEngine;
  /**
   * Render the view once all tiles it requests are loaded, or once `until`
   * returns true
   */
  render(view: View, until?: () => boolean): Promise<Uint8Array>;
  /** Render the view with whatever is cached, without waiting */
  renderNow(view: View): Uint8Array;
  setColorRange(min: number, max: number): void;
  /** Value at an image position from the tiles in memory */
  sampleAt(x: number, y: number): Sample | null;
  /** Tiles and bytes in the cache */
  cacheStats(): { tileCount: number; textureCount: number; bytes: number };
  /** Number of tile fetches so far */
  tileFetches(): number;
  /** Lose the WebGL context and wait until it is restored */
  loseContext(): Promise<void>;
  /** Answer fetches of tiles whose URL matches with an HTTP error; returns an undo function */
  rejectTiles(pattern: RegExp, status: number): () => void;
  /** Delay fetches of tiles whose URL matches; returns a release function */
  blockTiles(pattern: RegExp): () => void;
  dispose(): void;
}

const blocked: { pattern: RegExp; release: Promise<void> }[] = [];
const rejected: { pattern: RegExp; status: number }[] = [];
let tileFetches = 0;
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/dzdata_files/')) tileFetches++;
  for (const b of blocked) {
    if (b.pattern.test(url)) await b.release;
  }
  for (const r of rejected) {
    if (r.pattern.test(url)) return new Response(null, { status: r.status });
  }
  return originalFetch(input, init);
};

export function readPixels(canvas: HTMLCanvasElement): Uint8Array {
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
  /** Canvas size in CSS pixels */
  width?: number;
  height?: number;
  /** Device pixels per CSS pixel (default: the browser's) */
  pixelRatio?: number;
  colorRange?: [number, number];
  relief?: ReliefOptions | boolean;
  verticalExaggeration?: number;
  source?: TileSource;
  cacheBytes?: number;
}

export async function createDriver(ref: Reference, options: DriverOptions = {}): Promise<Driver> {
  const { width = 200, height = 160, colorRange } = options;
  if (options.pixelRatio !== undefined) {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: options.pixelRatio,
      configurable: true,
    });
  }
  const canvas = document.createElement('canvas');
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.display = 'block';
  document.body.appendChild(canvas);

  // The engine is driven with view transforms only
  const engine = await ZoomEngine.create(canvas, {
    source: options.source ?? new StaticTileSource(fixtureUrl(ref.name)),
    colorPalette: testPalette(),
    minValue: colorRange?.[0],
    maxValue: colorRange?.[1],
    cacheBytes: options.cacheBytes,
    relief: options.relief,
    verticalExaggeration: options.verticalExaggeration,
    noDataColor: (NO_DATA[0] | (NO_DATA[1] << 8) | (NO_DATA[2] << 16) | (255 << 24)) >>> 0,
  });

  // Test views are in device pixels of the canvas, engine views in CSS pixels
  const setView = (view: View) => {
    const dpr = engine.devicePixelRatio;
    engine.setView({
      k: view.k / dpr,
      x: view.tx / dpr,
      y: view.ty / dpr,
      rotation: view.rotation,
      tilt: view.tilt,
    });
  };

  return {
    canvas,
    engine,
    async render(view, until) {
      setView(view);
      engine.render();
      for (let i = 0; i < 200 && engine.isLoading() && !until?.(); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      engine.render();
      return readPixels(canvas);
    },
    renderNow(view) {
      setView(view);
      engine.render();
      return readPixels(canvas);
    },
    setColorRange(min, max) {
      engine.setColorRange(min, max);
    },
    sampleAt: (x, y) => engine.sampleAt(x, y),
    cacheStats: () => engine.cacheStats(),
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
    rejectTiles(pattern, status) {
      const entry = { pattern, status };
      rejected.push(entry);
      return () => void rejected.splice(rejected.indexOf(entry), 1);
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
      engine.dispose();
      canvas.remove();
      if (options.pixelRatio !== undefined) {
        delete (window as { devicePixelRatio?: number }).devicePixelRatio;
      }
    },
  };
}
