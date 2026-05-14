import { Palettes } from './palettes';
import { ZoomConfiguration } from './ZoomConfiguration';
import { TiledImage } from './TiledImage';
import type { ZoomDataOptions } from './types';

/**
 * Main entry point for zoomable data visualization.
 * Handles canvas interaction (zoom, pan) and orchestrates rendering.
 */
export class ZoomData {
  private readonly rootUrl: string;
  private readonly zoomLevelIncrement: number;

  private canvas: HTMLCanvasElement | null = null;
  private config: ZoomConfiguration | null = null;
  private tiledImage: TiledImage | null = null;

  // View state
  private xPos: number = 0;
  private yPos: number = 0;
  private zoomLevel: number = 0;

  // Drag state
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;

  // Render throttling
  private renderScheduled: boolean = false;
  private boundRender: () => void;

  // Event handler references (for cleanup)
  private boundWheelHandler: (e: WheelEvent) => void;
  private boundMouseDownHandler: (e: MouseEvent) => void;
  private boundMouseMoveHandler: (e: MouseEvent) => void;
  private boundMouseUpHandler: (e: MouseEvent) => void;
  private boundMouseLeaveHandler: (e: MouseEvent) => void;
  private boundDblClickHandler: (e: MouseEvent) => void;  // double-click for crosshair

  // Color mapping options
  private colorPalette: number[];
  private minValue: number;
  private maxValue: number;

  // Crosshair state (image pixel coordinates, null = not placed)
  private crosshairImageX: number | null = null;
  private crosshairImageY: number | null = null;


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
    this.rootUrl = options.rootUrl;
    this.zoomLevelIncrement = options.zoomLevelIncrement ?? 0.1;

    // Bind methods for event handlers
    this.boundRender = this.render.bind(this);
    this.boundWheelHandler = this.handleWheel.bind(this);
    this.boundMouseDownHandler = this.handleMouseDown.bind(this);
    this.boundMouseMoveHandler = this.handleMouseMove.bind(this);
    this.boundMouseUpHandler = this.handleMouseUp.bind(this);
    this.boundMouseLeaveHandler = this.handleMouseLeave.bind(this);
    this.boundDblClickHandler = this.handleDblClick.bind(this);

    // Store color mapping options
    this.colorPalette = options.colorPalette ?? Palettes.inferno(256);
    this.minValue = options.minValue ?? 0.0;
    this.maxValue = options.maxValue ?? 1.0;
  }

  /**
   * Initialize and start rendering to a canvas element
   * @param canvas - Canvas element or element ID
   */
  async start(canvas: HTMLCanvasElement | string): Promise<void> {
    // Get canvas element
    if (typeof canvas === 'string') {
      const element = document.getElementById(canvas);
      if (!element) {
        throw new Error(`Canvas element not found: ${canvas}`);
      }
      if (!(element instanceof HTMLCanvasElement)) {
        throw new Error(`Element is not a canvas: ${canvas}`);
      }
      this.canvas = element;
    } else {
      this.canvas = canvas;
    }


    // Load configuration
    this.config = new ZoomConfiguration(this.rootUrl);
    try {
      await this.config.fetch();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }

    // Create tiled image with WebGL renderer
    this.tiledImage = new TiledImage(this.config, 100);
    this.tiledImage.initRenderer(this.canvas, this.colorPalette, this.minValue, this.maxValue);

    // Set up tile load callback for re-rendering
    this.tiledImage.onTilesLoaded = () => {
      this.scheduleRender();
      // refresh line scans when new tiles arrive (they may now have data)
      if (this.crosshairImageX !== null && this.crosshairImageY !== null) {
      }
    };

    // Set initial zoom level (zoomed out a bit from max)
    // this.zoomLevel = Math.max(0, this.config.maxZoomLevel - 4);      
    this.zoomLevel = this.computeFitZoomLevel();   // made the change here to zoom in a bit more by default
    this.centerImage();

    // Install event handlers
    this.installEventHandlers();

    // Initial render
    this.scheduleRender();
  }

  /**
   * Stop rendering and clean up event handlers
   */
  stop(): void {
    this.removeEventHandlers();
    this.tiledImage?.dispose();
    this.canvas = null;
    this.tiledImage = null;
  }

  /**
   * Schedule a render on the next animation frame
   */
  private scheduleRender(): void {
    if (!this.renderScheduled) {
      this.renderScheduled = true;
      requestAnimationFrame(this.boundRender);
    }
  }

  /**
   * Perform the actual render
   */
  private render(): void {
    this.renderScheduled = false;

    if (!this.canvas || !this.tiledImage) {
      return;
    }

    this.tiledImage.renderTo(this.canvas, this.xPos, this.yPos, this.zoomLevel);

    // Draw the crosshair overlay on top of the WebGL canvas
    this.drawCrosshair();
  }

  /**
   * Draw the crosshair onto the transparent overlay canvas that sits on top of
   * the main WebGL canvas. The overlay canvas must have id = mainCanvas.id + '-crosshair'.
   */
  private drawCrosshair(): void {
    if (this.crosshairImageX === null || this.crosshairImageY === null) return;
    if (!this.canvas || !this.config) return;

    // Convert image pixel coordinates to screen coordinates
    const scale   = this.config.scaleFactorAtZoomLevel(this.zoomLevel);
    const screenX = this.xPos + this.crosshairImageX / scale;
    const screenY = this.yPos + this.crosshairImageY / scale;

    const overlay = document.getElementById(this.canvas.id + '-crosshair') as HTMLCanvasElement | null;
    if (!overlay) return;

    // Keep overlay size in sync with main canvas
    overlay.width  = this.canvas.width;
    overlay.height = this.canvas.height;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    ctx.strokeStyle = 'rgba(255, 75, 75, 0.9)';
    ctx.lineWidth   = 1.5;
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
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 4.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Install event handlers on the canvas
   */
  private installEventHandlers(): void {
    if (!this.canvas) return;

    this.canvas.addEventListener('wheel', this.boundWheelHandler, { passive: false });
    this.canvas.addEventListener('mousedown', this.boundMouseDownHandler);
    this.canvas.addEventListener('mousemove', this.boundMouseMoveHandler);
    this.canvas.addEventListener('mouseup', this.boundMouseUpHandler);
    this.canvas.addEventListener('mouseleave', this.boundMouseLeaveHandler);
    this.canvas.addEventListener('dblclick', this.boundDblClickHandler);
  }

  /**
   * Remove event handlers from the canvas
   */
  private removeEventHandlers(): void {
    if (!this.canvas) return;

    this.canvas.removeEventListener('wheel', this.boundWheelHandler);
    this.canvas.removeEventListener('mousedown', this.boundMouseDownHandler);
    this.canvas.removeEventListener('mousemove', this.boundMouseMoveHandler);
    this.canvas.removeEventListener('mouseup', this.boundMouseUpHandler);
    this.canvas.removeEventListener('mouseleave', this.boundMouseLeaveHandler);
    this.canvas.removeEventListener('dblclick', this.boundDblClickHandler);
  }

  /**
   * Handle mouse wheel for zooming
   */
  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    if (!this.canvas || !this.config) return;

    // Get mouse position relative to canvas
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert mouse position to data coordinates
    const oldScale = this.config.scaleFactorAtZoomLevel(this.zoomLevel);
    const dataX = (mouseX - this.xPos) * oldScale;
    const dataY = (mouseY - this.yPos) * oldScale;

    // Update zoom level (scroll down = zoom out = higher level number)
    const oldZoomLevel = this.zoomLevel;
    if (event.deltaY > 0) {
      this.zoomLevel = Math.min(this.config.maxZoomLevel, this.zoomLevel + this.zoomLevelIncrement);
    } else {
      this.zoomLevel = Math.max(0, this.zoomLevel - this.zoomLevelIncrement);
    }

    // Adjust position to keep mouse point stable
    const newScale = this.config.scaleFactorAtZoomLevel(this.zoomLevel);
    this.xPos = mouseX - dataX / newScale;
    this.yPos = mouseY - dataY / newScale;

    // Notify zoom change
    if (this.zoomLevel !== oldZoomLevel && this.onZoomChange) {
      this.onZoomChange(this.zoomLevel);
    }

    this.scheduleRender();
  }

  /**
   * Handle mouse down for starting drag
   */
  private handleMouseDown(event: MouseEvent): void {
    if (!this.canvas) return;

    this.isDragging = true;
    const rect = this.canvas.getBoundingClientRect();
    this.dragStartX = event.clientX - rect.left - this.xPos;
    this.dragStartY = event.clientY - rect.top - this.yPos;

    this.canvas.style.cursor = 'grabbing';
  }

  /**
   * Handle mouse move for dragging
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    this.xPos = event.clientX - rect.left - this.dragStartX;
    this.yPos = event.clientY - rect.top - this.dragStartY;

    this.scheduleRender();
  }

  /**
   * Handle mouse up for ending drag
   */
  private handleMouseUp(_event: MouseEvent): void {
    this.isDragging = false;
    if (this.canvas) {
      this.canvas.style.cursor = 'grab';
    }
  }

  /**
   * Handle mouse leave for ending drag
   */
  private handleMouseLeave(_event: MouseEvent): void {
    this.isDragging = false;
    if (this.canvas) {
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Handle double-click: place the crosshair at the clicked image position
   * and update the line scan panels.
   */
  private handleDblClick(event: MouseEvent): void {
    if (!this.canvas || !this.config) return;

    // Convert screen coordinates to image pixel coordinates
    const rect   = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const scale  = this.config.scaleFactorAtZoomLevel(this.zoomLevel);

    // Clamp to image bounds
    this.crosshairImageX = Math.max(0, Math.min(this.config.imageSize.Width  - 1, (mouseX - this.xPos) * scale));
    this.crosshairImageY = Math.max(0, Math.min(this.config.imageSize.Height - 1, (mouseY - this.yPos) * scale));

    if (this.onCrosshairChange) {
      this.onCrosshairChange(this.crosshairImageX, this.crosshairImageY);
    }

    this.scheduleRender();
  }

  /**
   * Clear the crosshair and reset the line scan panels to their empty state.
   */
  clearCrosshair(): void {
    this.crosshairImageX = null;
    this.crosshairImageY = null;

    // Clear the overlay canvas
    if (this.canvas?.id) {
      const overlay = document.getElementById(this.canvas.id + '-crosshair') as HTMLCanvasElement | null;
      if (overlay) {
        overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
      }
    }

    this.scheduleRender();
  }


  /**
   * Get the current zoom level
   */
  getZoomLevel(): number {
    return this.zoomLevel;
  }

  /**
   * Set the zoom level programmatically
   * @param level - The new zoom level
   */
  setZoomLevel(level: number): void {
    if (!this.config) return;

    this.zoomLevel = this.config.clampZoomLevel(level);
    this.scheduleRender();

    if (this.onZoomChange) {
      this.onZoomChange(this.zoomLevel);
    }
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
   * Get the current view position
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
    this.xPos = x;
    this.yPos = y;
    this.scheduleRender();
  }

  /**
   * Reset view to initial state (centered, default zoom)
   */

  // resetView(): void {
  //   this.xPos = 0;
  //   this.yPos = 0;
  //   if (this.config) {
  //     this.zoomLevel = Math.max(0, this.config.maxZoomLevel - 4);   // made the change here to zoom in a bit more by default
  //   }
  //   this.scheduleRender();
  // }

  resetView(): void {
  if (!this.canvas || !this.config) return;

  this.zoomLevel = this.computeFitZoomLevel();
  this.centerImage();
  this.scheduleRender();
}

  /**
   * Update the color mapping range
   * @param minValue - New minimum value
   * @param maxValue - New maximum value
   */
  setColorRange(minValue: number, maxValue: number): void {
    if (!this.tiledImage) return;

    this.minValue = minValue;
    this.maxValue = maxValue;
    this.tiledImage.setValueRange(minValue, maxValue);
    this.scheduleRender();
  }

  /**
   * Update the color palette (instant with WebGL - just updates GPU texture)
   * @param colorPalette - New color palette array
   */
  setColorPalette(colorPalette: number[]): void {
    if (!this.tiledImage) return;

    this.colorPalette = colorPalette;
    this.tiledImage.setPalette(colorPalette);
    this.scheduleRender();
  }

private computeFitZoomLevel(): number {
  if (!this.canvas || !this.config) return 0;

  const imageWidth = this.config.imageSize.Width;
  const imageHeight = this.config.imageSize.Height;

  const canvasWidth = this.canvas.width;
  const canvasHeight = this.canvas.height;

  const requiredScale = Math.max(
    imageWidth / canvasWidth,
    imageHeight / canvasHeight
  );

  const maxZoom = this.config.maxZoomLevel;

  const zoomLevel = maxZoom - Math.log2(requiredScale);

  return this.config.clampZoomLevel(zoomLevel);
}

private centerImage(): void {
  if (!this.canvas || !this.config) return;

  const scale = this.config.scaleFactorAtZoomLevel(this.zoomLevel);

  const imageWidth = this.config.imageSize.Width;
  const imageHeight = this.config.imageSize.Height;

  const scaledWidth = imageWidth / scale;
  const scaledHeight = imageHeight / scale;

  this.xPos = (this.canvas.width - scaledWidth) / 2;
  this.yPos = (this.canvas.height - scaledHeight) / 2;
}

}