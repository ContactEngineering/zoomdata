import { NetCDFReader } from 'netcdfjs';
import type { ColorMapper } from './ColorMapper';
import { TileState } from './types';

/**
 * Represents a single tile from a deep zoom image stack.
 * Handles fetching NetCDF data and rendering to canvas.
 */
export class Tile {
  private readonly colorMapper: ColorMapper;
  private readonly url: string;
  private canvas: OffscreenCanvas | null = null;
  private state: TileState = TileState.Pending;
  private error: Error | null = null;
  private fetchPromise: Promise<OffscreenCanvas> | null = null;

  /** Width of the tile in pixels (set after fetch) */
  width: number | null = null;
  /** Height of the tile in pixels (set after fetch) */
  height: number | null = null;

  /**
   * Create a new Tile
   * @param colorMapper - ColorMapper for rendering data to colors
   * @param url - URL to fetch the NetCDF tile data from
   */
  constructor(colorMapper: ColorMapper, url: string) {
    this.colorMapper = colorMapper;
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
    return this.state === TileState.Ready && this.canvas !== null;
  }

  /**
   * Fetch the tile data from the server
   * @returns Promise that resolves to the rendered canvas
   */
  async fetch(): Promise<OffscreenCanvas> {
    // Return existing promise if already fetching
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Return cached canvas if already loaded
    if (this.canvas && this.state === TileState.Ready) {
      return this.canvas;
    }

    this.state = TileState.Loading;
    this.error = null;

    this.fetchPromise = this.doFetch();
    return this.fetchPromise;
  }

  /**
   * Internal fetch implementation
   */
  private async doFetch(): Promise<OffscreenCanvas> {
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

      // Get dimensions from the heights variable itself (not global dimensions)
      // This ensures we get the correct shape even for edge tiles
      const heightsVar = reader.variables.find((v) => v.name === 'heights');
      if (!heightsVar) {
        throw new Error('NetCDF file missing "heights" variable metadata');
      }

      // The variable's dimensions array contains indices into reader.dimensions
      // The order matches the data layout (first dim varies slowest)
      const varDimensions = heightsVar.dimensions.map((dimIndex) => reader.dimensions[dimIndex]);

      // Data is stored with first dimension varying slowest (row-major within that convention)
      // For image rendering: first dimension = rows (height), second dimension = columns (width)
      if (varDimensions.length !== 2) {
        throw new Error(`Expected 2D heights variable, got ${varDimensions.length}D`);
      }

      // First dimension is rows (height), second is columns (width)
      this.height = varDimensions[0].size;
      this.width = varDimensions[1].size;

      // Render data to canvas
      this.canvas = this.colorMapper.render(heights as number[], this.width, this.height);
      this.state = TileState.Ready;

      return this.canvas;
    } catch (err) {
      this.state = TileState.Error;
      this.error = err instanceof Error ? err : new Error(String(err));
      this.fetchPromise = null;
      throw this.error;
    }
  }

  /**
   * Render the tile to a canvas context
   * @param context - The canvas 2D rendering context
   * @param x - X position to render at
   * @param y - Y position to render at
   * @param width - Width to render the tile
   * @param height - Height to render the tile
   * @param debug - If true, draw debug border
   * @returns True if the tile was rendered, false if still loading
   */
  renderTo(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    debug: boolean = false
  ): boolean {
    if (this.canvas && this.state === TileState.Ready) {
      context.drawImage(this.canvas, x, y, width, height);

      if (debug) {
        context.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        context.strokeRect(x, y, width, height);
      }

      return true;
    }

    // Start fetching if not already
    if (this.state === TileState.Pending) {
      this.fetch().catch(() => {
        // Error is stored in this.error, can be checked via getError()
      });
    }

    // Draw placeholder for loading/error states
    if (debug) {
      context.strokeStyle = this.state === TileState.Error ? 'red' : 'gray';
      context.setLineDash([5, 5]);
      context.strokeRect(x, y, width, height);
      context.setLineDash([]);
    }

    return false;
  }

  /**
   * Clear the cached canvas to free memory
   */
  clearCache(): void {
    this.canvas = null;
    this.fetchPromise = null;
    if (this.state === TileState.Ready) {
      this.state = TileState.Pending;
    }
  }
}
