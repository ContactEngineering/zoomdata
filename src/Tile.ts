import { decodeTile, type ValueEncoding } from './TileDecoder';
import { TileState } from './types';

export interface TileOptions {
  /** Expected width and height; a tile of another shape is rejected */
  expectedShape?: { width: number; height: number };
  /** Encoding used when the tile carries no scale_factor/add_offset */
  encoding?: ValueEncoding;
}

/**
 * Represents a single tile from a deep zoom image stack.
 * Stores the tile's values as float32 for GPU-based color mapping.
 */
export class Tile {
  private readonly url: string | (() => Promise<string | null>);
  private readonly options: TileOptions;
  private data: Float32Array | null = null;
  private encoding: ValueEncoding = { scaleFactor: 1, addOffset: 0 };
  private state: TileState = TileState.Pending;
  private error: Error | null = null;
  private fetchPromise: Promise<void> | null = null;
  xCoords: Float64Array | null = null;
  yCoords: Float64Array | null = null;

  /** Width of the tile in pixels (set after fetch) */
  width: number = 0;
  /** Height of the tile in pixels (set after fetch) */
  height: number = 0;

  /**
   * Create a new Tile
   * @param url - URL to fetch the NetCDF tile data from, or a function that
   *   resolves it when the tile is fetched (null if the tile does not exist)
   * @param options - Expected shape and default encoding
   */
  constructor(url: string | (() => Promise<string | null>), options: TileOptions = {}) {
    this.url = url;
    this.options = options;
  }

  /**
   * Get the current state of the tile
   */
  getState(): TileState {
    return this.state;
  }

  /**
   * Get the error if the tile failed to load
   */
  getError(): Error | null {
    return this.error;
  }

  /**
   * Check if the tile is ready to render
   */
  isReady(): boolean {
    return this.state === TileState.Ready && this.data !== null;
  }

  /**
   * Get the stored values, row-major (y, x), NaN where undefined. Physical
   * values are `addOffset + scaleFactor * v`, see getEncoding().
   */
  getData(): Float32Array | null {
    return this.data;
  }

  /**
   * Get the encoding of the stored values
   */
  getEncoding(): ValueEncoding {
    return this.encoding;
  }

  /**
   * Physical value at a tile pixel, computed in double precision
   */
  valueAt(x: number, y: number): number {
    if (!this.data) return NaN;
    return this.encoding.addOffset + this.encoding.scaleFactor * this.data[y * this.width + x];
  }

  /** get the x coordinates and y coordinates in micrometers */

  getXCoords(): Float64Array | null {
    return this.xCoords;
  }

  getYCoords(): Float64Array | null {
    return this.yCoords;
  }

  /**
   * Fetch the tile data from the server
   * @returns Promise that resolves when data is loaded
   */
  async fetch(): Promise<void> {
    // Return existing promise if already fetching
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Return immediately if already loaded
    if (this.data && this.state === TileState.Ready) {
      return;
    }

    this.state = TileState.Loading;
    this.error = null;

    this.fetchPromise = this.doFetch();
    return this.fetchPromise;
  }

  /**
   * Internal fetch implementation
   */
  private async doFetch(): Promise<void> {
    try {
      const url = typeof this.url === 'string' ? this.url : await this.url();
      if (url === null) {
        throw new Error('Tile not available');
      }
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const decoded = decodeTile(await response.arrayBuffer(), this.options.expectedShape);
      this.width = decoded.width;
      this.height = decoded.height;
      this.data = decoded.values;
      this.encoding = decoded.encoding ?? this.options.encoding ?? { scaleFactor: 1, addOffset: 0 };
      this.xCoords = decoded.x;
      this.yCoords = decoded.y;
      this.state = TileState.Ready;
    } catch (err) {
      this.state = TileState.Error;
      this.error = err instanceof Error ? err : new Error(String(err));
      this.fetchPromise = null;
      throw this.error;
    }
  }

  /**
   * Clear the cached data to free memory
   */
  clearCache(): void {
    this.data = null;
    this.fetchPromise = null;
    this.state = TileState.Pending;
  }
}
