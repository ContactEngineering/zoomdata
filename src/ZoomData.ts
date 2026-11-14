import { DefaultController } from './DefaultController';
import { LineScanRenderer, LineScanData } from './LineScanRenderer';
import type { Sample } from './sampling';
import type { TiledImage } from './TiledImage';
import { toTileSource, type TileSource } from './TileSource';
import type { ZoomDataOptions } from './types';
import type { ZoomConfiguration } from './ZoomConfiguration';
import { ZoomEngine, type View } from './ZoomEngine';

/**
 * Ready-made viewer: a ZoomEngine with the default input controller, a
 * crosshair and cross-section panels.
 *
 * Zoom levels relate to the engine's view scale k (CSS pixels per image
 * pixel) by k = 2^(zoomLevel - maxZoomLevel); zoomLevel = maxZoomLevel shows
 * the image at one image pixel per CSS pixel.
 */
export class ZoomData {
  private readonly source: TileSource;
  private readonly options: ZoomDataOptions;

  private engine: ZoomEngine | null = null;
  private controller: DefaultController | null = null;

  // Crosshair state (image pixel coordinates, null = not placed)
  private crosshairImageX: number | null = null;
  private crosshairImageY: number | null = null;

  // Line scan panel renderers (set via start())
  private hScanRenderer: LineScanRenderer | null = null; // horizontal profile (bottom panel)
  private vScanRenderer: LineScanRenderer | null = null; // vertical profile (left panel)

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
    this.source = toTileSource(source);
    this.options = options;
  }

  /** The engine, once started */
  getEngine(): ZoomEngine | null {
    return this.engine;
  }

  private get config(): ZoomConfiguration | null {
    return this.engine?.config ?? null;
  }

  private get tiledImage(): TiledImage | null {
    return this.engine?.tiles ?? null;
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

    // Set up line scan panel renderers
    if (this.options.horizontalScanCanvas) {
      this.hScanRenderer = new LineScanRenderer(this.options.horizontalScanCanvas);
      this.hScanRenderer.drawEmpty();
    }
    if (this.options.verticalScanCanvas) {
      this.vScanRenderer = new LineScanRenderer(this.options.verticalScanCanvas);
      this.vScanRenderer.drawEmpty();
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
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
    const engine = this.engine;

    engine.onRender = () => this.drawCrosshair();
    engine.onViewChange = () => {
      this.onZoomChange?.(this.zoomLevel);
      // Pan and zoom change the visible window, so the line scans follow
      if (this.crosshairImageX !== null && this.crosshairImageY !== null) {
        this.updateLineScanPanels();
      }
    };
    // Refresh line scans when new tiles arrive (they may now have data)
    engine.onTilesLoaded = () => {
      if (this.crosshairImageX !== null && this.crosshairImageY !== null) {
        this.updateLineScanPanels();
      }
    };

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
    this.controller?.dispose();
    this.engine?.dispose();
    this.controller = null;
    this.engine = null;
  }

  private scheduleRender(): void {
    this.engine?.scheduleRender();
  }

  /**
   * Draw the crosshair onto the transparent overlay canvas (option
   * crosshairCanvas) that sits on top of the main WebGL canvas.
   */
  private drawCrosshair(): void {
    const overlay = this.options.crosshairCanvas;
    if (!overlay || !this.engine) return;

    // Keep overlay size in sync with main canvas
    const { width, height } = this.engine.size;
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (this.crosshairImageX === null || this.crosshairImageY === null) return;

    // Convert image pixel coordinates to screen coordinates
    const { x: screenX, y: screenY } = this.engine.imageToScreen(
      this.crosshairImageX,
      this.crosshairImageY,
    );

    ctx.strokeStyle = 'rgba(255, 75, 75, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(overlay.width, screenY);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, overlay.height);
    ctx.stroke();

    ctx.setLineDash([]);

    // Dot at intersection with white ring
    ctx.fillStyle = 'rgba(255, 75, 75, 0.9)';
    ctx.beginPath();
    ctx.arc(screenX, screenY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 4.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Place the crosshair at an image position and update the line scan
   * panels.
   */
  placeCrosshair(imageX: number, imageY: number): void {
    if (!this.config) return;

    // Clamp to image bounds
    this.crosshairImageX = Math.max(0, Math.min(this.config.imageSize.Width - 1, imageX));
    this.crosshairImageY = Math.max(0, Math.min(this.config.imageSize.Height - 1, imageY));

    if (this.onCrosshairChange) {
      this.onCrosshairChange(this.crosshairImageX, this.crosshairImageY);
    }

    this.scheduleRender();
    this.updateLineScanPanels();
  }

  //  *******************Line scan extraction *********************

  /**
   * Extract a horizontal scan line at the given image Y coordinate.
   * Walks the tile cache from the highest available zoom level downward
   * and assembles the full row from cached tiles.
   * Returns null if no suitable tiles are available yet.
   *
   * @param imageY - image pixel Y of the scan row
   * @param crosshairImageX - image pixel X of the crosshair, so we can read the tile xCoords at that position
   * @param visImgX0 / visImgX1 - image pixel X of the left/right viewport edges,
   */
  extractHorizontalScan(
    imageY: number,
    crosshairImageX: number,
    visImgX0: number,
    visImgX1: number,
  ): {
    values: Float32Array;
    positions: Float32Array;
    crosshairPos: number;
    winMin: number;
    winMax: number;
  } | null {
    if (!this.config || !this.tiledImage) return null;

    const maxLevel = this.config.maxZoomLevel;
    const tileSize = this.config.tileSize;

    // Try each zoom level from highest detail to lowest
    const startLevel = Math.round(this.zoomLevel);
    for (let level = startLevel; level >= 0; level--) {
      const scaleFactor = Math.pow(2, maxLevel - level); // image pixels per tile pixel at this level
      const numCols = this.config.getNumColumns(level);
      const tileRow = Math.floor(imageY / scaleFactor / tileSize);

      // Assemble the scan line from all tiles in the row
      const pixelY = Math.floor(imageY / scaleFactor);
      const chunks: number[][] = [];
      const posChunks: number[][] = [];
      // Track the full-res image-pixel X of the first and last contributed sample so we can build an exact pixel position map even when
      // positions[] covers only part of the image (cached subset).
      let firstSampleImgX = -1;
      let lastSampleImgX = -1;

      for (let col = 0; col < numCols; col++) {
        const tile = this.tiledImage.getCachedTile(level, tileRow, col);
        if (!tile || !tile.isReady()) continue;
        const data = tile.getData();
        if (!data) continue;
        const xCoords = tile.getXCoords();
        if (!xCoords) continue;
        const localY = Math.max(0, Math.min(tile.height - 1, pixelY - tileRow * tileSize));
        const chunk: number[] = [];
        const posChunk: number[] = [];
        for (let x = 0; x < tile.width; x++) {
          chunk.push(data[localY * tile.width + x]);
          posChunk.push(xCoords[x]);
        }
        // Full-res image-pixel X of this tile's first (x=0) and last sample.
        const tileFirstImgX = col * tileSize * scaleFactor;
        const tileLastImgX = (col * tileSize + tile.width - 1) * scaleFactor;
        if (firstSampleImgX < 0) firstSampleImgX = tileFirstImgX;
        lastSampleImgX = tileLastImgX;
        chunks.push(chunk);
        posChunks.push(posChunk);
      }

      const total = chunks.reduce((s, c) => s + c.length, 0);
      if (total === 0) continue; // nothing cached at this level, try coarser
      const result = new Float32Array(total);
      const positions = new Float32Array(total);
      let idx = 0;
      for (let i = 0; i < chunks.length; i++) {
        for (let j = 0; j < chunks[i].length; j++) {
          result[idx] = chunks[i][j];
          positions[idx] = posChunks[i][j];
          idx++;
        }
      }

      // Resolve an image pixel X to a physical position by reading xCoords at its local pixel in whichever tile column contains it.

      const imgW = this.config.imageSize.Width;
      const resolveX = (imageX: number): number => {
        const px = Math.floor(imageX / scaleFactor);
        const tcol = Math.floor(px / tileSize);
        const t = this.tiledImage!.getCachedTile(level, tileRow, tcol);
        const xc = t?.getXCoords?.() ?? null;
        if (t && t.isReady() && xc) {
          const lx = Math.max(0, Math.min(t.width - 1, px - tcol * tileSize));
          return xc[lx];
        }
        //Fallback to fractional position if tile is not cached
        const lo = positions[0];
        const hi = positions[positions.length - 1];
        const f = Math.max(0, Math.min(1, imageX / (imgW - 1)));
        return lo + f * (hi - lo);
      };

      const crosshairPos = resolveX(crosshairImageX);

      // Map an image-pixel X to a physical position

      const firstPos = positions[0];
      const lastPos = positions[positions.length - 1];
      const pixelSpan = Math.max(1, lastSampleImgX - firstSampleImgX); // calculate the span of pixels between the first and last sample
      const physPerPixel = (lastPos - firstPos) / pixelSpan; //calculate the physical distance per pixel
      const edgeToPos = (imageX: number): number =>
        // covert both the left and right edges of the visible viewport to physical positions
        firstPos + (imageX - firstSampleImgX) * physPerPixel;

      const e0 = edgeToPos(visImgX0);
      const e1 = edgeToPos(visImgX1);

      return {
        values: result,
        positions,
        crosshairPos,
        winMin: Math.min(e0, e1),
        winMax: Math.max(e0, e1),
      };
    }

    return null; // no level had all tiles ready
  }

  /**
   * Extract a vertical scan line at the given image X coordinate.
   * Mirrors extractHorizontalScan but walks down a column of tiles.
   *
   */
  extractVerticalScan(
    imageX: number,
    crosshairImageY: number,
    visImgY0: number,
    visImgY1: number,
  ): {
    values: Float32Array;
    positions: Float32Array;
    crosshairPos: number;
    winMin: number;
    winMax: number;
  } | null {
    if (!this.config || !this.tiledImage) return null;

    const maxLevel = this.config.maxZoomLevel;
    const tileSize = this.config.tileSize;

    const startLevel = Math.round(this.zoomLevel);
    for (let level = startLevel; level >= 0; level--) {
      const scaleFactor = Math.pow(2, maxLevel - level);
      const numRows = this.config.getNumRows(level);
      const tileCol = Math.floor(imageX / scaleFactor / tileSize);

      // Assemble the scan line from all tiles in the column
      const pixelX = Math.floor(imageX / scaleFactor);
      const chunks: number[][] = [];
      const posChunks: number[][] = [];
      let firstSampleImgY = -1;
      let lastSampleImgY = -1;

      for (let row = 0; row < numRows; row++) {
        const tile = this.tiledImage.getCachedTile(level, row, tileCol);
        if (!tile || !tile.isReady()) continue;
        const data = tile.getData();
        if (!data) continue;
        const yCoords = tile.getYCoords();
        if (!yCoords) continue;
        const localX = Math.max(0, Math.min(tile.width - 1, pixelX - tileCol * tileSize));
        const chunk: number[] = [];
        const posChunk: number[] = [];
        for (let y = 0; y < tile.height; y++) {
          chunk.push(data[y * tile.width + localX]);
          posChunk.push(yCoords[y]);
        }
        const tileFirstImgY = row * tileSize * scaleFactor;
        const tileLastImgY = (row * tileSize + tile.height - 1) * scaleFactor;
        if (firstSampleImgY < 0) firstSampleImgY = tileFirstImgY;
        lastSampleImgY = tileLastImgY;
        chunks.push(chunk);
        posChunks.push(posChunk);
      }

      const total = chunks.reduce((s, c) => s + c.length, 0);
      if (total === 0) continue;
      const result = new Float32Array(total);
      const positions = new Float32Array(total);
      let idx = 0;
      for (let i = 0; i < chunks.length; i++) {
        for (let j = 0; j < chunks[i].length; j++) {
          result[idx] = chunks[i][j];
          positions[idx] = posChunks[i][j];
          idx++;
        }
      }

      // Resolve an image pixel Y to a physical position via yCoords in the tile row containing it

      const imgH = this.config.imageSize.Height;
      const resolveY = (imageY: number): number => {
        const py = Math.floor(imageY / scaleFactor);
        const trow = Math.floor(py / tileSize);
        const t = this.tiledImage!.getCachedTile(level, trow, tileCol);
        const yc = t?.getYCoords?.() ?? null;
        if (t && t.isReady() && yc) {
          const ly = Math.max(0, Math.min(t.height - 1, py - trow * tileSize));
          return yc[ly];
        }

        // fraction fallback only if that tile isn't cached.
        const lo = positions[0];
        const hi = positions[positions.length - 1];
        const f = Math.max(0, Math.min(1, imageY / (imgH - 1)));
        return lo + f * (hi - lo);
      };

      const crosshairPos = resolveY(crosshairImageY);

      //  Map an image-pixel Y to a physical position same as the horizontal scan, but for Y coordinates
      const firstPos = positions[0];
      const lastPos = positions[positions.length - 1];
      const pixelSpan = Math.max(1, lastSampleImgY - firstSampleImgY);
      const physPerPixel = (lastPos - firstPos) / pixelSpan;
      const edgeToPos = (imageY: number): number =>
        firstPos + (imageY - firstSampleImgY) * physPerPixel;

      const e0 = edgeToPos(visImgY0);
      const e1 = edgeToPos(visImgY1);

      return {
        values: result,
        positions,
        crosshairPos,
        winMin: Math.min(e0, e1),
        winMax: Math.max(e0, e1),
      };
    }

    return null; // no level had all tiles ready
  }

  /**
   * Rebuild both line scan panels from the current crosshair position.
   * Called after double-click and whenever new tiles arrive.
   */
  updateLineScanPanels(): void {
    if (this.crosshairImageX === null || this.crosshairImageY === null) return;
    if (!this.config) return;

    // ***** Visible viewport edges in image pixel coordinates *****
    // We pass these to the extractors, which resolve them to physical positions using the same tile xCoords/yCoords as the trace.
    /* Viewport edges in image-pixel space. These are not clamped to the image bounds.
    When zoomed out the canvas extends beyond the image (grey margins) so the left edge is negative and the right edge exceeds imgW-1. 
    Passing the raw edges lets the extractors extrapolate the window past the image extent
    so the graph shrinks to match the image block on the main canvas */

    const scale = this.config.scaleFactorAtZoomLevel(this.zoomLevel);

    const visImgX0 = -this.xPos * scale; // left canvas edge (negative when zoomed out)
    const visImgX1 = (this.engine!.size.width - this.xPos) * scale; // right edge (> imgW-1 when zoomed out)
    const visImgY0 = -this.yPos * scale;
    const visImgY1 = (this.engine!.size.height - this.yPos) * scale;

    // Helper: convert stored tile values to physical height values
    const colorbarMin = this.config.colorbarRange?.Minimum;
    const colorbarMax = this.config.colorbarRange?.Maximum;
    const hasColorbarRange = colorbarMin !== undefined && colorbarMax !== undefined;
    const { scaleFactor, addOffset } = this.config.descriptor.encoding;
    const toPhys = (v: number) => addOffset + scaleFactor * v;

    const valueAxisLabel = `${this.config.colorbarTitle ?? 'Height'}`;

    const finiteRange = (arr: Float32Array): { min: number; max: number } => {
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (!isFinite(min)) {
        min = 0;
        max = 1;
      } else if (min === max) {
        min -= 0.5;
        max += 0.5;
      }
      return { min, max };
    };

    // **************** Horizontal scan panel*****************************
    if (this.hScanRenderer) {
      const hScan = this.extractHorizontalScan(
        this.crosshairImageY,
        this.crosshairImageX,
        visImgX0,
        visImgX1,
      );
      if (hScan && hScan.values.length > 0) {
        const { values: raw, positions, crosshairPos, winMin, winMax } = hScan;
        const n = raw.length;
        const physValues = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          physValues[i] = toPhys(raw[i]);
        }
        const { min: vMin, max: vMax } = hasColorbarRange
          ? { min: colorbarMin!, max: colorbarMax! }
          : finiteRange(physValues);
        const scanData: LineScanData = {
          values: physValues, // normalised height values converted to physical units
          positions: positions, // physical positions along the scan line in micro meters
          crosshairPos, // physical position of the crosshair along the scan line in micro meters
          posMin: winMin, //
          posMax: winMax,
          posAxisLabel: 'x-position',
          valueAxisLabel,
          orientation: 'horizontal',
          valueMin: vMin, //lowest height value
          valueMax: vMax, //highest height value
        };
        this.hScanRenderer.draw(scanData);
      } else {
        this.hScanRenderer.drawEmpty();
      }
    }

    // *********** Vertical scan panel ****************************
    if (this.vScanRenderer) {
      const vScan = this.extractVerticalScan(
        this.crosshairImageX,
        this.crosshairImageY,
        visImgY0,
        visImgY1,
      );
      if (vScan && vScan.values.length > 0) {
        const { values: raw, positions, crosshairPos, winMin, winMax } = vScan;
        const n = raw.length;
        const physValues = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          physValues[i] = toPhys(raw[i]);
        }
        const { min: vMin, max: vMax } = hasColorbarRange
          ? { min: colorbarMin!, max: colorbarMax! }
          : finiteRange(physValues);
        const scanData: LineScanData = {
          values: physValues,
          positions: positions,
          crosshairPos,
          posMin: winMin,
          posMax: winMax,
          posAxisLabel: 'y-position',
          valueAxisLabel,
          orientation: 'vertical',
          valueMin: vMin,
          valueMax: vMax,
        };
        this.vScanRenderer.draw(scanData);
      } else {
        this.vScanRenderer.drawEmpty();
      }
    }
  }

  /**
   * Clear the crosshair and reset the line scan panels to their empty state.
   */
  clearCrosshair(): void {
    this.crosshairImageX = null;
    this.crosshairImageY = null;
    this.hScanRenderer?.drawEmpty();
    this.vScanRenderer?.drawEmpty();
    // The overlay is cleared on the next render
    this.scheduleRender();
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
   * Update the color palette (instant with WebGL - just updates GPU texture)
   * @param colorPalette - New color palette array
   */
  setColorPalette(colorPalette: number[]): void {
    this.engine?.setColorPalette(colorPalette);
  }
}
