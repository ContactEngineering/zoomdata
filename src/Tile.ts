import { NetCDFReader } from 'netcdfjs';
import { TileState } from './types';

/**
 * Represents a single tile from a deep zoom image stack.
 * Stores raw float data for GPU-based color mapping.
 */
export class Tile {
  private readonly url: string;
  private data: Float32Array | null = null;
  private state: TileState = TileState.Pending;
  private error: Error | null = null;
  private fetchPromise: Promise<void> | null = null;

  /** Width of the tile in pixels (set after fetch) */
  width: number = 0;
  /** Height of the tile in pixels (set after fetch) */
  height: number = 0;

  /**
   * Create a new Tile
   * @param url - URL to fetch the NetCDF tile data from
   */
  constructor(url: string) {
    this.url = url;
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
   * Get the raw data for GPU texture creation
   */
  getData(): Float32Array | null {
    return this.data;
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
      const response = await fetch(this.url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const reader = new NetCDFReader(arrayBuffer);

      // Get the heights variable
      const heights = reader.getDataVariable('heights');
      if (!heights) {
        throw new Error('NetCDF file missing "heights" variable');
      }

      // Get dimensions from the heights variable itself
      const heightsVar = reader.variables.find((v) => v.name === 'heights');
      if (!heightsVar) {
        throw new Error('NetCDF file missing "heights" variable metadata');
      }

      // The variable's dimensions array contains indices into reader.dimensions
      const varDimensions = heightsVar.dimensions.map((dimIndex) => reader.dimensions[dimIndex]);

      if (varDimensions.length !== 2) {
        throw new Error(`Expected 2D heights variable, got ${varDimensions.length}D`);
      }

      // First dimension is rows (height), second is columns (width)
      this.height = varDimensions[0].size;
      this.width = varDimensions[1].size;

      // Store raw data as Float32Array
      this.data = new Float32Array(heights as number[]);

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
