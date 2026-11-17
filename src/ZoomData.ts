import { DefaultController } from './DefaultController.js';
import { CrossSections } from './CrossSections.js';
import type { ReliefOptions } from './relief.js';
import type { Sample } from './sampling.js';
import type { PyramidReader } from './PyramidReader.js';
import { toPyramidReader } from './sources.js';
import type { ZoomDataOptions } from './types.js';
import type { ZoomConfiguration } from './ZoomConfiguration.js';
import { ZoomEngine, type View } from './ZoomEngine.js';

/**
 * Ready-made viewer: a ZoomEngine with the default input controller, a
 * crosshair and cross-section panels.
 *
 * Zoom levels relate to the engine's view scale k (CSS pixels per image
 * pixel) by k = 2^(zoomLevel - maxZoomLevel); zoomLevel = maxZoomLevel shows
 * the image at one image pixel per CSS pixel.
 */
export class ZoomData {
  private readonly source: PyramidReader;
  private readonly options: ZoomDataOptions;

  private engine: ZoomEngine | null = null;
  private controller: DefaultController | null = null;

  private crossSections: CrossSections | null = null;

  // Callbacks
  onZoomChange: ((zoomLevel: number) => void) | null = null;
  onError: ((error: Error) => void) | null = null;
  /** Fired when the crosshair is placed or moved. imageX/Y are in image pixel coordinates. */
  onCrosshairChange: ((imageX: number, imageY: number) => void) | null = null;

  /**
   * Create a new ZoomData instance
   * @param options - Configuration options
   */
  constructor(options: ZoomDataOptions) {
    const source = options.source ?? options.rootUrl;
    if (source === undefined) {
      throw new Error('ZoomData: either source or rootUrl is required');
    }
    this.source = toPyramidReader(source);
    this.options = options;
  }

  /** The engine, once started */
  getEngine(): ZoomEngine | null {
    return this.engine;
  }

  private get config(): ZoomConfiguration | null {
    return this.engine?.config ?? null;
  }

  private get zoomLevel(): number {
    if (!this.engine) return 0;
    return this.engine.config.maxZoomLevel + Math.log2(this.engine.view.k);
  }

  private get xPos(): number {
    return this.engine?.view.x ?? 0;
  }

  private get yPos(): number {
    return this.engine?.view.y ?? 0;
  }

  /**
   * Initialize and start rendering to a canvas element
   * @param canvas - Canvas element, or for convenience its id
   */
  async start(canvas: HTMLCanvasElement | string): Promise<void> {
    let element: HTMLCanvasElement;
    if (typeof canvas === 'string') {
      const found = document.getElementById(canvas);
      if (!found) {
        throw new Error(`Canvas element not found: ${canvas}`);
      }
      if (!(found instanceof HTMLCanvasElement)) {
        throw new Error(`Element is not a canvas: ${canvas}`);
      }
      element = found;
    } else {
      element = canvas;
    }

    try {
      this.engine = await ZoomEngine.create(element, {
        source: this.source,
        colorPalette: this.options.colorPalette,
        minValue: this.options.minValue,
        maxValue: this.options.maxValue,
        noDataColor: this.options.noDataColor,
        backgroundColor: this.options.backgroundColor,
        cacheBytes: this.options.cacheBytes,
        loader: this.options.loader,
        autoResize: this.options.autoResize,
        relief: this.options.relief,
        verticalExaggeration: this.options.verticalExaggeration,
        antialias: this.options.antialias,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
    const engine = this.engine;

    engine.onViewChange = () => this.onZoomChange?.(this.zoomLevel);
    this.crossSections = new CrossSections(engine, {
      overlayCanvas: this.options.crosshairCanvas,
      horizontalCanvas: this.options.horizontalScanCanvas,
      verticalCanvas: this.options.verticalScanCanvas,
      onChange: (p) => {
        if (p) this.onCrosshairChange?.(p.x, p.y);
      },
    });

    if (this.options.controller !== false) {
      this.controller = new DefaultController(engine, {
        wheelZoomFactor: 2 ** (this.options.zoomLevelIncrement ?? 0.25),
        onDoubleClick: (x, y) => this.placeCrosshair(x, y),
      });
    }
  }

  /**
   * Stop rendering and clean up event handlers
   */
  stop(): void {
    this.crossSections?.dispose();
    this.crossSections = null;
    this.controller?.dispose();
    this.engine?.dispose();
    this.controller = null;
    this.engine = null;
  }

  /**
   * Place the crosshair at an image position and update the line scan
   * panels.
   */
  placeCrosshair(imageX: number, imageY: number): void {
    this.crossSections?.place(imageX, imageY);
  }

  /**
   * Crosshair position in image pixels, or null
   */
  getCrosshair(): { x: number; y: number } | null {
    return this.crossSections?.crosshair ?? null;
  }

  /**
   * Clear the crosshair and reset the line scan panels to their empty state.
   */
  clearCrosshair(): void {
    this.crossSections?.clear();
  }

  /**
   * Image position (image pixels) of a canvas position (CSS pixels)
   */
  screenToImage(x: number, y: number): { x: number; y: number } | null {
    return this.engine?.screenToImage(x, y) ?? null;
  }

  /**
   * Value at an image position, in physical units, from the finest level
   * currently in memory. Does not fetch tiles; returns null outside the
   * image or when no covering tile is loaded.
   */
  sampleAt(imageX: number, imageY: number): Sample | null {
    return this.engine?.sampleAt(imageX, imageY) ?? null;
  }

  /**
   * Get the current zoom level
   */
  getZoomLevel(): number {
    return this.zoomLevel;
  }

  /**
   * Set the zoom level, keeping the canvas centre fixed
   * @param level - The new zoom level
   */
  setZoomLevel(level: number): void {
    if (!this.engine) return;
    const view = this.engine.view;
    const k = 2 ** (level - this.engine.config.maxZoomLevel);
    const { width, height } = this.engine.size;
    const f = k / view.k;
    this.engine.setView({
      ...view,
      k,
      x: width / 2 - f * (width / 2 - view.x),
      y: height / 2 - f * (height / 2 - view.y),
    });
  }

  /**
   * Get the maximum zoom level
   */
  getMaxZoomLevel(): number {
    return this.config?.maxZoomLevel ?? 0;
  }

  getImageWidth(): number {
    return this.config?.imageSize.Width ?? 0;
  }

  getImageHeight(): number {
    return this.config?.imageSize.Height ?? 0;
  }

  getOverlap(): number {
    return this.config?.overlap ?? 0;
  }

  /* get the colorbar range and title */

  getMinColorBarRange(): number {
    return this.config?.colorbarRange?.Minimum ?? 0;
  }

  getMaxColorBarRange(): number {
    return this.config?.colorbarRange?.Maximum ?? 0;
  }

  getColorbarTitle(): string | null {
    return this.config?.colorbarTitle ?? null;
  }

  /**
   * Get the pixels per meter value
   */
  getPixelsPerMeterWidth(): number {
    return this.config?.pixelsPerMeter?.Width ?? 0;
  }

  getPixelsPerMeterHeight(): number {
    return this.config?.pixelsPerMeter?.Height ?? 0;
  }

  /**
   * Get the current view position (image origin in CSS pixels)
   */
  getPosition(): { x: number; y: number } {
    return { x: this.xPos, y: this.yPos };
  }

  /**
   * Set the view position programmatically
   * @param x - X position
   * @param y - Y position
   */
  setPosition(x: number, y: number): void {
    if (!this.engine) return;
    this.engine.setView({ ...this.engine.view, x, y });
  }

  /**
   * Get the view transform (screen = k * image + (x, y), CSS pixels)
   */
  getView(): View | null {
    return this.engine?.view ?? null;
  }

  /**
   * Set the view transform
   */
  setView(view: View): void {
    this.engine?.setView(view);
  }

  /**
   * Reset view to show the whole image
   */
  resetView(): void {
    if (!this.engine) return;
    this.engine.setView(this.engine.fitView());
  }

  /**
   * Update the color mapping range
   * @param minValue - New minimum value, in physical units
   * @param maxValue - New maximum value, in physical units
   */
  setColorRange(minValue: number, maxValue: number): void {
    this.engine?.setColorRange(minValue, maxValue);
  }

  /**
   * Exaggerate the heights of the surface in the tilted view
   */
  setVerticalExaggeration(exaggeration: number): void {
    this.engine?.setVerticalExaggeration(exaggeration);
  }

  /**
   * Switch relief shading on (`true` or options) or off (`false`)
   */
  setRelief(relief: ReliefOptions | boolean): void {
    this.engine?.setRelief(relief);
  }

  /**
   * Update the color palette (instant with WebGL - just updates GPU texture)
   * @param colorPalette - New color palette array
   */
  setColorPalette(colorPalette: number[]): void {
    this.engine?.setColorPalette(colorPalette);
  }
}
