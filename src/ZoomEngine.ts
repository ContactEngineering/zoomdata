import { Palettes } from './palettes.js';
import type { TileAddress } from './PyramidGeometry.js';
import type { Sample } from './sampling.js';
import { TiledImage } from './TiledImage.js';
import type { TileLoaderOptions } from './TileLoader.js';
import type { TileSource } from './TileSource.js';
import { ZoomConfiguration } from './ZoomConfiguration.js';

/**
 * View transform in CSS pixels of the canvas: `screen = k * image + (x, y)`,
 * where image coordinates are pixels of the full-resolution image.
 */
export interface View {
  k: number;
  x: number;
  y: number;
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
  /** Where the descriptor and tiles come from, or the root URL of a static pyramid */
  source: TileSource | string;
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

  private _view: View = { k: 1, x: 0, y: 0 };
  private pixelRatio = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private frame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private _colorRange: [number, number];

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
      { noData: options.noDataColor, background: options.backgroundColor },
    );
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
    this.scheduleRender();
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

  get view(): View {
    return { ...this._view };
  }

  /**
   * Set the view transform and schedule a render
   */
  setView(view: View): void {
    if (!(view.k > 0) || !Number.isFinite(view.x) || !Number.isFinite(view.y)) {
      throw new Error(`Invalid view ${JSON.stringify(view)}`);
    }
    this._view = { ...view };
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
  fitView(): View {
    const { Width: w, Height: h } = this.config.imageSize;
    const k = Math.min(this.cssWidth / w, this.cssHeight / h);
    return { k, x: (this.cssWidth - k * w) / 2, y: (this.cssHeight - k * h) / 2 };
  }

  /** Image position of a canvas position in CSS pixels */
  screenToImage(x: number, y: number): { x: number; y: number } {
    const { k, x: tx, y: ty } = this._view;
    return { x: (x - tx) / k, y: (y - ty) / k };
  }

  /** Canvas position in CSS pixels of an image position */
  imageToScreen(x: number, y: number): { x: number; y: number } {
    const { k, x: tx, y: ty } = this._view;
    return { x: k * x + tx, y: k * y + ty };
  }

  /** Visible part of the image, in image pixels (may extend beyond the image) */
  visibleImageRect(): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.screenToImage(0, 0);
    const b = this.screenToImage(this.cssWidth, this.cssHeight);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
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
    const { k, x, y } = this._view;
    this.tiledImage.render(this.canvas, { k: k * dpr, tx: x * dpr, ty: y * dpr });
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
