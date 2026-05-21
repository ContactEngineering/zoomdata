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
  xCoords: Float32Array | null = null;
  yCoords: Float32Array | null = null;

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

  /** get the x coordinates and y coordinates in micrometers */
  
  getXCoords(): Float32Array | null {
    return this.xCoords;
  }

  getYCoords(): Float32Array | null {
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

      const x = reader.getDataVariable('x')  // x and y values 
      if (!x) {
        throw new Error('NetCDF file missing "x" variable');
      }
      const y = reader.getDataVariable('y')
      if (!y) {
        throw new Error('NetCDF file missing "y" variable');
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

      // Store x and y coordinates as Float32Arrays 
      this.xCoords = new Float32Array(x as number[]);
      this.yCoords = new Float32Array(y as number[]);

      // Debug: verify dimensions match data length
      const expectedLength = this.width * this.height;
      if (this.data.length !== expectedLength) {
        console.error(`Tile ${this.url}: dimension mismatch! width=${this.width}, height=${this.height}, expected=${expectedLength}, actual=${this.data.length}`);
        console.error(`  varDimensions:`, varDimensions);
      } else {
        console.log(`Tile ${this.url}: loaded ${this.width}x${this.height} = ${this.data.length} values`);
      }

      this.state = TileState.Ready;
    } catch (err) {
      this.state = TileState.Error;
      this.error = err instanceof Error ? err : new Error(String(err));
      this.fetchPromise = null;
      throw this.error;
    }


    console.log("X coords:", this.xCoords, "Y coords:", this.yCoords);
  }

  /**
   * Clear the cached data to free memory
   */
  clearCache(): void {
    this.data = null;
    this.fetchPromise = null;
    if (this.state === TileState.Ready) {
      this.state = TileState.Pending;
    }
  }
}
