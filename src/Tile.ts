import {
  decodeTile,
  TileDecodeError,
  type DecodedTile,
  type ValueEncoding,
} from './TileDecoder.js';
import { TileState } from './types.js';

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
  /** Unit of the values as the tile states it, if it does (set after load) */
  unit: string | null = null;
  private state: TileState = TileState.Pending;
  private error: Error | null = null;

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
    let decoded: DecodedTile;
    try {
      decoded = decodeTile(buffer, this.options.expectedShape);
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
    this.setDecoded(decoded);
  }

  /**
   * Take the values of a decoded tile; marks the tile as failed and throws
   * if their shape is not the expected one
   */
  setDecoded(decoded: DecodedTile): void {
    const expected = this.options.expectedShape;
    if (expected && (expected.width !== decoded.width || expected.height !== decoded.height)) {
      const err = new TileDecodeError(
        `shape ${decoded.width} x ${decoded.height}, expected ${expected.width} x ${expected.height}`,
      );
      this.fail(err);
      throw err;
    }
    this.width = decoded.width;
    this.height = decoded.height;
    this.data = decoded.values;
    this.encoding = decoded.encoding ?? this.options.encoding ?? { scaleFactor: 1, addOffset: 0 };
    this.unit = decoded.unit;
    this.state = TileState.Ready;
    this.error = null;
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
    return this.data?.byteLength ?? 0;
  }

  /**
   * Clear the cached data to free memory
   */
  clearCache(): void {
    this.data = null;
    this.state = TileState.Pending;
  }
}
