import { parseDescriptor, type PyramidDescriptor } from './PyramidDescriptor';
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

  private _descriptor: PyramidDescriptor | null = null;
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
   * Get the validated descriptor (throws if not loaded)
   */
  get descriptor(): PyramidDescriptor {
    this.assertLoaded();
    return this._descriptor!;
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

      const descriptor = parseDescriptor(data);
      this._descriptor = descriptor;
      this._imageSize = descriptor.size;
      this._tileSize = descriptor.tileSize;
      this._overlap = descriptor.overlap;
      this._colorbarRange = descriptor.colorbarRange;
      this._colorbarTitle = descriptor.colorbarTitle;
      this._pixelsPerMeter = descriptor.pixelsPerMeter;

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
}
