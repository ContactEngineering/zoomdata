import type { ColorbarRange, DZIMetadata, ImageSize } from './types';

/**
 * Represents the global zoom configuration loaded from dzdata.json.
 * Contains information about image dimensions, tile size, and zoom levels.
 */
export class ZoomConfiguration {
  readonly rootUrl: string;
  readonly baseUrl: string;

  private _imageSize: ImageSize | null = null;
  private _tileSize: number | null = null;
  private _overlap: number | null = null;
  private _maxZoomLevel: number | null = null;
  private _loaded: boolean = false;
  private _colorbarRange: ColorbarRange | null = null;
  private _colorbarTitle: string | null = null;
  private _pixelsPerMeter: ImageSize | null = null;

  /**
   * Create a new ZoomConfiguration
   * @param rootUrl - Root URL where dzdata.json is located
   */
  constructor(rootUrl: string) {
    // Ensure rootUrl ends with /
    this.rootUrl = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`;
    this.baseUrl = `${this.rootUrl}dzdata_files/`;
  }

  /**
   * Check if configuration has been loaded
   */
  get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Get the image size (throws if not loaded)
   */
  get imageSize(): ImageSize {
    this.assertLoaded();
    return this._imageSize!;
  }

  /**
   * Get the tile size (throws if not loaded)
   */
  get tileSize(): number {
    this.assertLoaded();
    return this._tileSize!;
  }

  /**
   * Get the overlap (throws if not loaded)
   */
  get overlap(): number {
    this.assertLoaded();
    return this._overlap!;
  }

  /**
   * Get the maximum zoom level (throws if not loaded)
   */
  get maxZoomLevel(): number {
    this.assertLoaded();
    return this._maxZoomLevel!;
  }

  /**
   * Get the colorbar range, or null if not specified in the configuration
   */
  get colorbarRange(): ColorbarRange | null {
    this.assertLoaded();
    return this._colorbarRange;
  }

  get colorbarTitle(): string {
    this.assertLoaded();
    return this._colorbarTitle ? this._colorbarTitle : 'Height';
  }

  /* Get the pixels per meter value */
  get pixelsPerMeter(): ImageSize {
    this.assertLoaded();
    return this._pixelsPerMeter!;
  }

  /**
   * Assert that configuration is loaded
   */
  private assertLoaded(): void {
    if (!this._loaded) {
      throw new Error('ZoomConfiguration not loaded. Call fetch() first.');
    }
  }

  /**
   * Fetch and parse the dzdata.json configuration file
   * @returns This ZoomConfiguration instance (for chaining)
   */
  async fetch(): Promise<this> {
    const url = `${this.rootUrl}dzdata.json`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: DZIMetadata = await response.json();

      // Validate required fields
      if (!data.Image) {
        throw new Error('Invalid dzdata.json: missing "Image" field');
      }
      if (
        !data.Image.Size ||
        typeof data.Image.Size.Width !== 'number' ||
        typeof data.Image.Size.Height !== 'number'
      ) {
        throw new Error('Invalid dzdata.json: missing or invalid "Image.Size"');
      }
      if (typeof data.Image.TileSize !== 'number') {
        throw new Error('Invalid dzdata.json: missing or invalid "Image.TileSize"');
      }

      this._imageSize = data.Image.Size;
      this._tileSize = data.Image.TileSize;
      this._overlap = data.Image.Overlap ?? 0;
      this._colorbarRange = data.Image.ColorbarRange ?? null;
      this._colorbarTitle = data.Image.ColorbarTitle ?? null;
      this._pixelsPerMeter = data.Image.PixelsPerMeter ?? null;

      // Calculate max zoom level based on DZI convention:
      // - Level N has 2^N pixel resolution
      // - At level log2(tileSize), one tile covers tileSize pixels at 1:1 scale
      // - This is the "natural" max zoom level where scaleFactor = 1
      // Higher levels (if they exist in the data) show sub-pixel zoom
      this._maxZoomLevel = Math.ceil(
        Math.log2(Math.max(this._imageSize!.Width, this._imageSize!.Height)),
      );

      this._loaded = true;
      return this;
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`Failed to load zoom configuration from ${url}: ${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * Calculate the scale factor at a given zoom level.
   * Higher zoom levels = smaller scale factor = more zoomed in.
   * @param zoomLevel - The zoom level (can be fractional)
   * @returns Scale factor (pixels in data space per pixel in screen space)
   */
  scaleFactorAtZoomLevel(zoomLevel: number): number {
    this.assertLoaded();
    return Math.pow(2, this._maxZoomLevel! - zoomLevel);
  }

  /**
   * Get the number of tile columns at a given zoom level
   * @param zoomLevel - The integer zoom level
   * @returns Number of columns
   */
  getNumColumns(zoomLevel: number): number {
    this.assertLoaded();
    const scaleFactor = this.scaleFactorAtZoomLevel(zoomLevel);
    return Math.ceil(this._imageSize!.Width / (scaleFactor * this._tileSize!));
  }

  /**
   * Get the number of tile rows at a given zoom level
   * @param zoomLevel - The integer zoom level
   * @returns Number of rows
   */
  getNumRows(zoomLevel: number): number {
    this.assertLoaded();
    const scaleFactor = this.scaleFactorAtZoomLevel(zoomLevel);
    return Math.ceil(this._imageSize!.Height / (scaleFactor * this._tileSize!));
  }

  /**
   * Clamp a zoom level to valid bounds
   * @param zoomLevel - The zoom level to clamp.
   * @returns Clamped zoom level between 0 and maxZoomLevel
   */
  clampZoomLevel(zoomLevel: number): number {
    this.assertLoaded();
    return Math.max(0, Math.min(this._maxZoomLevel!, zoomLevel));
  }

  /**
   * Get the URL for a specific tile
   * @param zoomLevel - The zoom level
   * @param row - The row index
   * @param column - The column index
   * @returns Full URL to the tile file
   */
  getTileUrl(zoomLevel: number, row: number, column: number): string {
    // DZI convention: files are named column_row (x_y)
    return `${this.baseUrl}${zoomLevel}/${column}_${row}.nc`;
  }
}
