import { decodeTile, type ValueEncoding } from './TileDecoder';
import { TileState } from './types';

export interface TileOptions {
  /** Expected width and height; a tile of another shape is rejected */
  expectedShape?: { width: number; height: number };
  /** Encoding used when the tile carries no scale_factor/add_offset */
  encoding?: ValueEncoding;
}

/**
 * A single tile of the pyramid: its loading state and, once loaded, its
 * values as float32 for GPU-based color mapping. Tiles are fetched by the
 * TileLoader.
 */
export class Tile {
  private readonly options: TileOptions;
  private data: Float32Array | null = null;
  private encoding: ValueEncoding = { scaleFactor: 1, addOffset: 0 };
  private state: TileState = TileState.Pending;
  private error: Error | null = null;
  xCoords: Float64Array | null = null;
  yCoords: Float64Array | null = null;

  /** Width of the tile in pixels (set after load) */
  width: number = 0;
  /** Height of the tile in pixels (set after load) */
  height: number = 0;

  /**
   * Create a new Tile
   * @param options - Expected shape and default encoding
   */
  constructor(options: TileOptions = {}) {
    this.options = options;
  }

  /**
   * Get the current state of the tile
   */
  getState(): TileState {
    return this.state;
  }

  /**
   * Set the loading state (used by the loader)
   */
  setState(state: TileState.Pending | TileState.Loading): void {
    this.state = state;
    this.error = null;
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
   * Decode the contents of the tile file; marks the tile as failed and
   * throws if they are invalid
   */
  load(buffer: ArrayBuffer): void {
    try {
      const decoded = decodeTile(buffer, this.options.expectedShape);
      this.width = decoded.width;
      this.height = decoded.height;
      this.data = decoded.values;
      this.encoding = decoded.encoding ?? this.options.encoding ?? { scaleFactor: 1, addOffset: 0 };
      this.xCoords = decoded.x;
      this.yCoords = decoded.y;
      this.state = TileState.Ready;
      this.error = null;
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /**
   * Mark the tile as failed
   */
  fail(error: Error): void {
    this.state = TileState.Error;
    this.error = error;
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

  /**
   * Bytes of tile data held in CPU memory
   */
  byteSize(): number {
    return (
      (this.data?.byteLength ?? 0) +
      (this.xCoords?.byteLength ?? 0) +
      (this.yCoords?.byteLength ?? 0)
    );
  }

  /** get the x coordinates and y coordinates in micrometers */

  getXCoords(): Float64Array | null {
    return this.xCoords;
  }

  getYCoords(): Float64Array | null {
    return this.yCoords;
  }

  /**
   * Clear the cached data to free memory
   */
  clearCache(): void {
    this.data = null;
    this.xCoords = null;
    this.yCoords = null;
    this.state = TileState.Pending;
  }
}
