import { PyramidGeometry } from './PyramidGeometry';
import { toTileSource, type TileSource } from './TileSource';
import type { ColorbarRange, ImageSize } from './types';

/**
 * Represents the global zoom configuration loaded from the pyramid
 * descriptor. Contains information about image dimensions, tile size, and
 * zoom levels.
 */
export class ZoomConfiguration {
  readonly source: TileSource;

  private _geometry: PyramidGeometry | null = null;
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
   * @param source - Tile source, or root URL of a static pyramid
   */
  constructor(source: TileSource | string) {
    this.source = toTileSource(source);
  }

  /**
   * Check if configuration has been loaded
   */
  get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Get the pyramid geometry (throws if not loaded)
   */
  get geometry(): PyramidGeometry {
    this.assertLoaded();
    return this._geometry!;
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
   * Fetch and parse the pyramid descriptor
   * @returns This ZoomConfiguration instance (for chaining)
   */
  async fetch(): Promise<this> {
    try {
      const data = await this.source.descriptor();

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

      this._geometry = new PyramidGeometry(this._imageSize, this._tileSize, this._overlap);
      this._maxZoomLevel = this._geometry.maxLevel;

      this._loaded = true;
      return this;
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`Failed to load zoom configuration: ${err.message}`, {
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
}
