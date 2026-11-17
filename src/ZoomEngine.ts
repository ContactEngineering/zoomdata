import { footprint, isPlain, MAX_TILT, orbit, project, unproject, type Camera } from './camera.js';
import { Palettes } from './palettes.js';
import type { TileAddress } from './PyramidGeometry.js';
import type { PyramidReader } from './PyramidReader.js';
import { resolveRelief, type ReliefOptions } from './relief.js';
import type { Sample } from './sampling.js';
import { TiledImage } from './TiledImage.js';
import type { TileLoaderOptions } from './TileLoader.js';
import type { TileSource } from './TileSource.js';
import { ZoomConfiguration } from './ZoomConfiguration.js';

/**
 * View transform in CSS pixels of the canvas: `screen = k * image + (x, y)`,
 * where image coordinates are pixels of the full-resolution image.
 *
 * With a `rotation` or a `tilt` the map shows as a surface in an
 * orthographic view: turned clockwise by `rotation` degrees and tipped back
 * by `tilt` degrees (0 looks straight down, at most 75). (x, y) is then the
 * screen position of the image origin at the reference height, the middle
 * of the range of the values.
 */
export interface View {
  k: number;
  x: number;
  y: number;
  rotation?: number;
  tilt?: number;
}

/** A point of the surface under a position of the canvas */
export interface Pick {
  /** Image position */
  x: number;
  y: number;
  /** Value there, or null outside the map or where no tile is loaded */
  sample: Sample | null;
}

/** Events of ZoomEngine.on() */
export interface ZoomEngineEvents {
  /** After every render */
  render: () => void;
  /** After the view changed */
  view: (view: View) => void;
  /** After tiles finished loading */
  tiles: () => void;
}

export interface ZoomEngineOptions {
  /**
   * Pyramid: a reader (e.g. a ZarrSource), a TileSource of NetCDF tiles, or
   * a URL, of a zipped OME-Zarr file (`.ozx`) or of the root directory of a
   * static NetCDF pyramid
   */
  source: PyramidReader | TileSource | string;
  /** Color palette (array of 32-bit ABGR integers) */
  colorPalette?: number[];
  /** Value mapped to the first palette entry, in physical units (default: data minimum) */
  minValue?: number;
  /** Value mapped to the last palette entry, in physical units (default: data maximum) */
  maxValue?: number;
  /** Colour of undefined points, 32-bit ABGR (default: transparent) */
  noDataColor?: number;
  /** Colour behind the image, 32-bit ABGR (default: light grey) */
  backgroundColor?: number;
  /** Memory budget for tiles in bytes, CPU and GPU (default: 256 MiB) */
  cacheBytes?: number;
  /** Concurrency and retries of tile requests */
  loader?: TileLoaderOptions;
  /**
   * Relief shading: light the map from one direction so that slopes show.
   * `true` uses the defaults (default: off)
   */
  relief?: ReliefOptions | boolean;
  /** Vertical exaggeration of the surface in the tilted view (default: 1) */
  verticalExaggeration?: number;
  /**
   * Smooth the tilted or rotated view: edges of the surface, and borders
   * between values smaller than a pixel. The plain view is never smoothed.
   * (default: true)
   */
  antialias?: boolean;
  /**
   * Size the canvas' drawing buffer to its CSS size times the device pixel
   * ratio, and follow changes of either (default: true)
   */
  autoResize?: boolean;
}

/**
 * Engine for a zoomable height map on a canvas. It loads and draws tiles for
 * a view transform set from outside and has no input handling and no DOM
 * lookups; a host drives it with setView(), e.g. from DefaultController or
 * its own gesture handling.
 */
export class ZoomEngine {
  readonly canvas: HTMLCanvasElement;
  readonly config: ZoomConfiguration;
  private readonly tiledImage: TiledImage;
  private readonly autoResize: boolean;

  private _view: Required<View> = { k: 1, x: 0, y: 0, rotation: 0, tilt: 0 };
  private pixelRatio = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private frame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private _colorRange: [number, number];
  private _relief: Required<ReliefOptions> | null = null;
  private _verticalExaggeration = 1;

  /** Called after every render, e.g. to update overlays */
  onRender: (() => void) | null = null;
  /** Called when the view changes */
  onViewChange: ((view: View) => void) | null = null;
  /** Called when tiles finished loading (after the render they caused is scheduled) */
  onTilesLoaded: (() => void) | null = null;

  private listeners: { [E in keyof ZoomEngineEvents]: Set<ZoomEngineEvents[E]> } = {
    render: new Set(),
    view: new Set(),
    tiles: new Set(),
  };

  /**
   * Load the pyramid descriptor and create an engine drawing to the canvas.
   * The initial view fits the image into the canvas.
   */
  static async create(canvas: HTMLCanvasElement, options: ZoomEngineOptions): Promise<ZoomEngine> {
    const config = new ZoomConfiguration(options.source);
    await config.fetch();
    return new ZoomEngine(canvas, config, options);
  }

  private constructor(
    canvas: HTMLCanvasElement,
    config: ZoomConfiguration,
    options: ZoomEngineOptions,
  ) {
    this.canvas = canvas;
    this.config = config;
    this.autoResize = options.autoResize ?? true;

    // The colour range defaults to the range of the data
    const { encoding, colorbarRange } = config.descriptor;
    this._colorRange = [
      options.minValue ?? colorbarRange?.Minimum ?? encoding.addOffset,
      options.maxValue ?? colorbarRange?.Maximum ?? encoding.addOffset + encoding.scaleFactor,
    ];

    this.tiledImage = new TiledImage(config, options.cacheBytes, options.loader);
    this.tiledImage.initRenderer(
      canvas,
      options.colorPalette ?? Palettes.inferno(256),
      ...this._colorRange,
      {
        noData: options.noDataColor,
        background: options.backgroundColor,
        antialias: options.antialias,
      },
    );
    this.setRelief(options.relief ?? false);
    this.tiledImage.onTilesLoaded = () => {
      this.scheduleRender();
      this.onTilesLoaded?.();
      for (const listener of this.listeners.tiles) listener();
    };

    this.measure();
    if (this.autoResize && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(canvas);
      this.watchPixelRatio();
    }
    this._view = this.fitView();
    this.setVerticalExaggeration(options.verticalExaggeration ?? 1);
  }

  /** Read the CSS size and pixel ratio, and size the drawing buffer */
  private measure(): void {
    const canvas = this.canvas;
    const dpr = this.autoResize ? (globalThis.devicePixelRatio ?? 1) : 1;
    // A canvas without layout (not in the document) keeps its buffer size
    const cssWidth = canvas.clientWidth || canvas.width / dpr;
    const cssHeight = canvas.clientHeight || canvas.height / dpr;
    this.pixelRatio = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    if (!this.autoResize) return;

    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width === w && canvas.height === h) return;
    // A canvas without a CSS size is laid out at the size of its drawing
    // buffer, so resizing the buffer would resize the layout, and that the
    // buffer again, without end. Fix the CSS size of such a canvas.
    const style = canvas.clientWidth ? getComputedStyle(canvas) : null;
    const before = style && { width: style.width, height: style.height };
    canvas.width = w;
    canvas.height = h;
    if (before && (canvas.clientWidth !== cssWidth || canvas.clientHeight !== cssHeight)) {
      canvas.style.width = before.width;
      canvas.style.height = before.height;
    }
  }

  private handleResize(): void {
    this.measure();
    this.scheduleRender();
  }

  /** Re-measure when the device pixel ratio changes (zoom, other screen) */
  private watchPixelRatio(): void {
    if (typeof matchMedia === 'undefined') return;
    this.dprQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
    this.dprQuery.addEventListener('change', this.handlePixelRatioChange, { once: true });
  }

  private readonly handlePixelRatioChange = () => {
    this.handleResize();
    this.watchPixelRatio();
  };

  /** Size of the canvas in CSS pixels */
  get size(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /** Device pixels per CSS pixel used for rendering */
  get devicePixelRatio(): number {
    return this.pixelRatio;
  }

  /** The view, with rotation and tilt (0 in the plain view) */
  get view(): Required<View> {
    return { ...this._view };
  }

  /** Whether the map shows as a tilted or rotated surface */
  get isTilted(): boolean {
    return !isPlain(this._view);
  }

  private get camera(): Camera {
    const { k, x, y, rotation, tilt } = this._view;
    return { k, tx: x, ty: y, rotation, tilt };
  }

  /**
   * Set the view transform and schedule a render
   */
  setView(view: View): void {
    const { rotation = 0, tilt = 0 } = view;
    if (
      !(view.k > 0) ||
      !Number.isFinite(view.x) ||
      !Number.isFinite(view.y) ||
      !Number.isFinite(rotation) ||
      !(tilt >= 0 && tilt <= MAX_TILT)
    ) {
      throw new Error(`Invalid view ${JSON.stringify(view)}`);
    }
    this._view = { k: view.k, x: view.x, y: view.y, rotation, tilt };
    this.scheduleRender();
    this.onViewChange?.(this.view);
    for (const listener of this.listeners.view) listener(this.view);
  }

  /**
   * Listen to an event, in addition to the on* callbacks; returns a
   * function that removes the listener
   */
  on<E extends keyof ZoomEngineEvents>(event: E, listener: ZoomEngineEvents[E]): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  /**
   * Keep tiles loaded beyond the view, e.g. along a cross-section; they load
   * after the visible tiles. Replaces earlier requests of the same owner.
   */
  requestTiles(owner: string, addresses: TileAddress[]): void {
    this.tiledImage.setExtraTiles(owner, addresses);
    this.scheduleRender();
  }

  /**
   * View that shows the whole image centred in the canvas
   */
  fitView(): Required<View> {
    const { Width: w, Height: h } = this.config.imageSize;
    const k = Math.min(this.cssWidth / w, this.cssHeight / h);
    return {
      k,
      x: (this.cssWidth - k * w) / 2,
      y: (this.cssHeight - k * h) / 2,
      rotation: 0,
      tilt: 0,
    };
  }

  /**
   * View turned and tilted to the given angles (degrees) about the point of
   * the map at a canvas position, by default the centre of the canvas. The
   * tilt is limited to [0, 75].
   */
  orbitView(rotation: number, tilt: number, pivot?: { x: number; y: number }): Required<View> {
    const p = pivot ?? { x: this.cssWidth / 2, y: this.cssHeight / 2 };
    const c = orbit(this.camera, rotation, tilt, p.x, p.y);
    return { k: c.k, x: c.tx, y: c.ty, rotation: c.rotation, tilt: c.tilt };
  }

  /**
   * Image position of a canvas position in CSS pixels. In the tilted view
   * this is the point of the reference plane there; see pick() for the
   * point of the surface.
   */
  screenToImage(x: number, y: number): { x: number; y: number } {
    const p = unproject(this.camera, x, y);
    return { x: p.u, y: p.v };
  }

  /**
   * Canvas position in CSS pixels of an image position; in the tilted view,
   * of the point of the surface with the given value there, or of the
   * reference plane if no value is given
   */
  imageToScreen(x: number, y: number, value?: number): { x: number; y: number } {
    const z = value === undefined || Number.isNaN(value) ? 0 : this.heightOf(value);
    const p = project(this.camera, x, y, z);
    return { x: p.x, y: p.y };
  }

  /**
   * Height of a value above the reference plane of the tilted view, in
   * image pixels, with the vertical exaggeration applied
   */
  heightOf(value: number): number {
    const { scale, reference } = this.tiledImage.surfaceHeight();
    return (value - reference) * scale;
  }

  /**
   * Visible part of the image, in image pixels (may extend beyond the
   * image). In the tilted view this is the bounding box of everything that
   * can show.
   */
  visibleImageRect(): { x0: number; y0: number; x1: number; y1: number } {
    if (!this.isTilted) return footprint(this.camera, this.cssWidth, this.cssHeight);
    const { zMin, zMax } = this.tiledImage.surfaceHeight();
    return footprint(this.camera, this.cssWidth, this.cssHeight, zMin, zMax);
  }

  /**
   * Height of the surface of the tilted view at an image position, in image
   * pixels above the reference plane, or null outside the map or where no
   * tile is loaded. The surface is the one the renderer draws: a vertex at
   * the centre of every pixel of the level, squares split along one
   * diagonal, undefined values in the reference plane.
   */
  private surfaceZ(u: number, v: number, level: number): number | null {
    const geometry = this.config.geometry;
    if (!(u >= 0 && v >= 0 && u <= geometry.width && v <= geometry.height)) return null;
    const s = geometry.stride(level);
    const size = geometry.levelSize(level);
    const { scale, reference } = this.tiledImage.surfaceHeight();
    const fx = u / s - 0.5;
    const fy = v / s - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const wx = fx - i0;
    const wy = fy - j0;
    const z: number[] = [];
    for (const [di, dj] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const i = Math.min(size.width - 1, Math.max(0, i0 + di));
      const j = Math.min(size.height - 1, Math.max(0, j0 + dj));
      // The last pixels of a level may be cut off by the border of the map
      const sample = this.sampleAt(
        Math.min((i + 0.5) * s, geometry.width - 1e-6),
        Math.min((j + 0.5) * s, geometry.height - 1e-6),
        level,
      );
      if (!sample) return null;
      z.push(Number.isNaN(sample.value) ? 0 : (sample.value - reference) * scale);
    }
    return wx + wy <= 1
      ? z[0] + wx * (z[1] - z[0]) + wy * (z[2] - z[0])
      : z[3] + (1 - wx) * (z[2] - z[3]) + (1 - wy) * (z[1] - z[3]);
  }

  /**
   * Point of the map that shows at a canvas position (CSS pixels), with its
   * value from the level in view. In the tilted view this is the foremost
   * point of the surface there. Reads the tiles in memory only.
   */
  pick(x: number, y: number): Pick {
    const camera = this.camera;
    const level = this.level;
    const at = (z: number) => {
      const p = unproject(camera, x, y, z);
      return { x: p.u, y: p.v };
    };
    const result = (p: { x: number; y: number }, found = true): Pick => ({
      ...p,
      sample: found ? this.sampleAt(p.x, p.y, level) : null,
    });
    const tan = Math.tan((camera.tilt * Math.PI) / 180);
    if (tan === 0) return result(at(0));

    // Follow the line of sight from the viewer, starting above the highest
    // possible point: the surface shows where the line first crosses it,
    // from above or, seen from under an edge, from below. A step moves the
    // position by a fifth of a pixel of the level in view.
    const { zMin, zMax } = this.tiledImage.surfaceHeight();
    const stride = this.config.geometry.stride(level);
    const margin = 1e-6 * (zMax - zMin) + 1e-9;
    const top = zMax + margin;
    const bottom = zMin - margin;
    // Height of the line of sight above the surface
    const above = (z: number) => {
      const p = at(z);
      const surface = this.surfaceZ(p.x, p.y, level);
      return surface === null ? null : z - surface;
    };
    const steps = Math.min(8192, Math.ceil(((top - bottom) * tan) / (0.2 * stride)) + 1);
    let zPrev = top;
    let fPrev = above(top);
    for (let n = 1; n <= steps; n++) {
      const z = top - ((top - bottom) * n) / steps;
      const f = above(z);
      if (f !== null && fPrev !== null && f > 0 !== fPrev > 0) {
        let hi = zPrev;
        let lo = z;
        for (let i = 0; i < 40; i++) {
          const mid = (hi + lo) / 2;
          const fMid = above(mid);
          if (fMid !== null && fMid > 0 === fPrev > 0) hi = mid;
          else lo = mid;
        }
        return result(at((hi + lo) / 2));
      }
      zPrev = z;
      fPrev = f;
    }
    return result(at(0), false);
  }

  /**
   * Value at an image position, in physical units, from the finest level in
   * memory, or from maxLevel or coarser. Does not fetch tiles; returns null
   * outside the image or when no covering tile is loaded.
   */
  sampleAt(imageX: number, imageY: number, maxLevel?: number): Sample | null {
    return this.tiledImage.sampleAt(imageX, imageY, maxLevel);
  }

  /** Level drawn for the current view */
  get level(): number {
    return this.tiledImage.levelForScale(this._view.k * this.pixelRatio);
  }

  get colorRange(): [number, number] {
    return [...this._colorRange];
  }

  setColorRange(min: number, max: number): void {
    this._colorRange = [min, max];
    this.tiledImage.setValueRange(min, max);
    this.scheduleRender();
  }

  /** Relief shading in use, with defaults filled in, or null if it is off */
  get relief(): Required<ReliefOptions> | null {
    return this._relief && { ...this._relief };
  }

  /**
   * Switch relief shading on (`true` or options) or off (`false`). Like the
   * colour range, it applies instantly, without reloading tiles.
   */
  setRelief(relief: ReliefOptions | boolean): void {
    this._relief = resolveRelief(relief);
    this.tiledImage.setRelief(this._relief);
    this.scheduleRender();
  }

  /**
   * Switch the smoothing of the tilted or rotated view. It takes four
   * samples per pixel, so it costs four times the fill work and memory of
   * that view; canvases beyond about 10 megapixels are drawn without.
   */
  setAntialias(antialias: boolean): void {
    this.tiledImage.setAntialias(antialias);
    this.scheduleRender();
  }

  /** Vertical exaggeration of the surface in the tilted view */
  get verticalExaggeration(): number {
    return this._verticalExaggeration;
  }

  /**
   * Exaggerate the heights of the surface in the tilted view. At 1 heights
   * and lateral distances have the same scale, if the pyramid states the
   * unit of its values and its pixel size.
   */
  setVerticalExaggeration(exaggeration: number): void {
    if (!(exaggeration >= 0) || !Number.isFinite(exaggeration)) {
      throw new Error(`Invalid vertical exaggeration ${exaggeration}`);
    }
    this._verticalExaggeration = exaggeration;
    this.tiledImage.setVerticalExaggeration(exaggeration);
    this.scheduleRender();
  }

  setColorPalette(palette: number[]): void {
    this.tiledImage.setPalette(palette);
    this.scheduleRender();
  }

  /** Whether tiles are queued or loading */
  isLoading(): boolean {
    return this.tiledImage.isLoading();
  }

  /** Tiles and bytes in the cache */
  cacheStats(): { tileCount: number; textureCount: number; bytes: number } {
    return this.tiledImage.getCacheStats();
  }

  /** The tiled image (tile cache and loader), for helpers that read tiles */
  get tiles(): TiledImage {
    return this.tiledImage;
  }

  /**
   * Render on the next animation frame
   */
  scheduleRender(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  /**
   * Render now, synchronously
   */
  render(): void {
    const dpr = this.pixelRatio;
    const { k, x, y, rotation, tilt } = this._view;
    this.tiledImage.render(this.canvas, { k: k * dpr, tx: x * dpr, ty: y * dpr, rotation, tilt });
    this.onRender?.();
    for (const listener of this.listeners.render) listener();
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver?.disconnect();
    this.dprQuery?.removeEventListener('change', this.handlePixelRatioChange);
    this.tiledImage.dispose();
  }
}
