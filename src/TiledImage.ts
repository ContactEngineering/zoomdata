import type { ZoomConfiguration } from './ZoomConfiguration';
import { Tile } from './Tile';
import { TileCache } from './TileCache';
import { WebGLRenderer, TileTexture } from './WebGLRenderer';
import { TileState, type RenderCallback } from './types';

/**
 * Manages rendering of a tiled zoomable image using WebGL.
 * Handles tile caching, GPU texture management, and fallback rendering.
 */
export class TiledImage {
  private readonly config: ZoomConfiguration;
  private readonly tileCache: TileCache;

  private renderer: WebGLRenderer | null = null;
  private textureCache: Map<string, TileTexture> = new Map();

  /** Callback invoked when tiles finish loading and need re-render */
  onTilesLoaded: RenderCallback | null = null;

  /**
   * Create a new TiledImage
   * @param config - The zoom configuration
   * @param maxCacheSize - Maximum number of tiles to cache (default: 100)
   */
  constructor(config: ZoomConfiguration, maxCacheSize: number = 100) {
    this.config = config;
    this.tileCache = new TileCache(maxCacheSize);
    this.tileCache.onEvict = (key) => {
      const texture = this.textureCache.get(key);
      if (texture) {
        this.renderer?.deleteTileTexture(texture);
        this.textureCache.delete(key);
      }
    };
  }

  /**
   * Initialize the WebGL renderer for a canvas
   */
  initRenderer(
    canvas: HTMLCanvasElement,
    palette: number[],
    minValue: number,
    maxValue: number,
  ): void {
    this.renderer = new WebGLRenderer(canvas, palette, minValue, maxValue);
  }

  /**
   * Update the color palette
   */
  setPalette(palette: number[]): void {
    this.renderer?.setPalette(palette);
  }

  /**
   * Update the value range
   */
  setValueRange(minValue: number, maxValue: number): void {
    // For WebGL renderer, we need to recreate textures with new normalization
    // Clear texture cache to force re-creation
    this.clearTextureCache();
    this.renderer?.setValueRange(minValue, maxValue);
  }

  /**
   * Calculate which integer zoom level to use for tile data.
   */
  private getDataZoomLevel(fractionalZoomLevel: number): number {
    const rounded = Math.round(fractionalZoomLevel);
    return Math.max(0, Math.min(this.config.maxZoomLevel, rounded));
  }

  /**
   * Calculate the data scale factor for a given fractional zoom level.
   */
  private getDataScaleFactor(fractionalZoomLevel: number): number {
    const levelDiff = this.config.maxZoomLevel - fractionalZoomLevel;
    const roundedDiff = Math.floor(levelDiff + 0.5);
    const clampedDiff = Math.max(0, roundedDiff);
    const dataScaleFactor = Math.pow(2, clampedDiff);
    const maxScaleFactor = this.config.imageSize.Width / this.config.tileSize;
    return Math.min(dataScaleFactor, maxScaleFactor);
  }

  /**
   * Get or create a WebGL texture for a tile
   */
  private getTileTexture(tile: Tile, cacheKey: string): TileTexture | null {
    if (!this.renderer) return null;

    // Check texture cache first
    const cached = this.textureCache.get(cacheKey);
    if (cached) return cached;

    // Create texture from tile data
    const data = tile.getData();
    if (!data) return null;

    console.log(
      `getTileTexture ${cacheKey}: tile.width=${tile.width}, tile.height=${tile.height}, data.length=${data.length}`,
    );
    const texture = this.renderer.createTileTexture(data, tile.width, tile.height);
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  /**
   * Get or fetch a tile, starting the fetch if needed
   */
  private getOrFetchTile(level: number, row: number, col: number): Tile {
    const cacheKey = TileCache.makeKey(level, row, col);
    let tile = this.tileCache.get(cacheKey);

    if (!tile) {
      const url = this.config.getTileUrl(level, row, col);
      tile = new Tile(url);
      this.tileCache.set(cacheKey, tile);
    }

    // Start fetching if not already
    if (tile.getState() === TileState.Pending) {
      tile
        .fetch()
        .then(() => {
          if (this.onTilesLoaded) {
            this.onTilesLoaded();
          }
        })
        .catch(() => {
          if (this.onTilesLoaded) {
            this.onTilesLoaded();
          }
        });
    }

    return tile;
  }

  /**
   * Render a single tile if ready, returns true if rendered
   */
  private renderTile(
    level: number,
    row: number,
    col: number,
    x: number,
    y: number,
    // size: number
    width: number,
    height: number,
  ): boolean {
    if (!this.renderer) return false;

    const tile = this.getOrFetchTile(level, row, col);
    const cacheKey = TileCache.makeKey(level, row, col);

    if (tile.isReady()) {
      const texture = this.getTileTexture(tile, cacheKey);
      if (texture) {
        // console.log(`Rendering tile ${cacheKey} at (${x}, ${y}) size ${size}`);
        // this.renderer.renderTile(texture, x, y, size, size);

        // console.log(`Rendering tile ${cacheKey} at (${x}, ${y}) size ${width}x${height}`);
        // this.renderer.renderTile(texture, x, y, width, height);

        // check for overlaps to make sure the tiles are correctly aligned.
        const ov = this.config.overlap;
        const tileSize = this.config.tileSize;

        const hasLeft = col > 0; // overlap on left if not in first column
        const hasTop = row > 0; // overlap on top if not in first row

        const leftOverlap = hasLeft ? ov : 0;
        const topOverlap = hasTop ? ov : 0;

        const availableW = texture.width - leftOverlap;
        const availableH = texture.height - topOverlap;

        const texX = leftOverlap / texture.width;
        const texY = topOverlap / texture.height;
        const texW = Math.min(tileSize, availableW) / texture.width; // clamping done to avoid sampling outside texture when overlaps are present
        const texH = Math.min(tileSize, availableH) / texture.height;

        console.log(`Rendering tile ${cacheKey} at (${x}, ${y}) size ${width}x${height}`);

        this.renderer.renderTileRegion(texture, x, y, width, height, texX, texY, texW, texH);
        return true;
      }
    }

    console.log(`Tile ${cacheKey} not ready (state: ${tile.getState()})`);
    return false;
  }

  /**
   * Find and render a fallback tile from a lower zoom level
   */
  private renderFallback(
    targetLevel: number,
    row: number,
    col: number,
    x: number,
    y: number,
    // size: number
    width: number,
    height: number,
  ): boolean {
    if (!this.renderer) return false;

    // Debug: log what we're looking for
    console.log(`Fallback needed for tile (${targetLevel}, ${row}, ${col})`);
    console.log(`Cache has ${this.tileCache.size} tiles:`, [...this.tileCache.keys()]);

    // Try each lower level until we find a loaded tile
    for (let level = targetLevel - 1; level >= 0; level--) {
      const levelDiff = targetLevel - level;
      const scale = Math.pow(2, levelDiff);

      // Which tile at this level contains our target tile?
      const parentRow = Math.floor(row / scale);
      const parentCol = Math.floor(col / scale);

      const cacheKey = TileCache.makeKey(level, parentRow, parentCol);
      const tile = this.tileCache.get(cacheKey);

      console.log(
        `  Looking for ${cacheKey}: ${tile ? (tile.isReady() ? 'READY' : 'loading') : 'not in cache'}`,
      );

      if (tile && tile.isReady()) {
        const texture = this.getTileTexture(tile, cacheKey);
        if (texture) {
          // Calculate which portion of the parent tile to render
          // The parent tile covers 'scale x scale' child tiles
          const subCol = col % scale;
          const subRow = row % scale;

          // Texture coordinates for the quadrant
          const texLeft = subCol / scale;
          const texTop = subRow / scale;
          const texSize = 1 / scale;

          console.log(
            `  Using ${cacheKey} with tex coords (${texLeft}, ${texTop}, ${texSize}, ${texSize})`,
          );

          // Render just this portion of the parent texture
          this.renderer.renderTileRegion(
            texture,
            // x, y, size, size,
            x,
            y,
            width,
            height,
            texLeft,
            texTop,
            texSize,
            texSize,
          );
          return true;
        }
      }
    }

    console.log(`  No fallback found!`);
    return false;
  }

  /**
   * Render the tiled image to a canvas
   */
  renderTo(
    canvas: HTMLCanvasElement,
    xPos: number,
    yPos: number,
    fractionalZoomLevel: number,
  ): void {
    if (!this.renderer) {
      throw new Error('TiledImage.renderTo: renderer not initialized');
    }

    // Clear canvas
    this.renderer.clear();

    // Calculate scale factors
    const displayScaleFactor = this.config.scaleFactorAtZoomLevel(fractionalZoomLevel);
    const dataScaleFactor = this.getDataScaleFactor(fractionalZoomLevel);
    const dataZoomLevel = this.getDataZoomLevel(fractionalZoomLevel);

    // Calculate number of tiles at this data zoom level
    const numColumns = Math.ceil(
      this.config.imageSize.Width / (dataScaleFactor * this.config.tileSize),
    );
    const numRows = Math.ceil(
      this.config.imageSize.Height / (dataScaleFactor * this.config.tileSize),
    );

    console.log(
      `--- Render frame: zoomLevel=${fractionalZoomLevel.toFixed(2)}, dataZoomLevel=${dataZoomLevel}, tiles=${numColumns}x${numRows} ---`,
    );

    // Calculate rendered tile size on screen
    const scaledTileSize = this.config.tileSize * (dataScaleFactor / displayScaleFactor);

    // Render visible tiles
    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numColumns; col++) {
        console.log(
          `Processing tile (${dataZoomLevel}, ${row}, ${col})`,
          'position:',
          xPos,
          yPos,
          'scaledTileSize:',
          scaledTileSize,
        );

        const tileX = Math.round(xPos + col * scaledTileSize);
        const tileY = Math.round(yPos + row * scaledTileSize);
        const tileW = Math.round(xPos + (col + 1) * scaledTileSize) - tileX; // get actual pixel size to avoid gaps/overlaps due to rounding
        const tileH = Math.round(yPos + (row + 1) * scaledTileSize) - tileY;

        // Skip tiles outside visible area
        if (
          !this.isTileVisible(tileX, tileY, Math.max(tileW, tileH), canvas.width, canvas.height)
        ) {
          continue;
        }

        // // Try to render the tile, fall back to lower resolution if not loaded
        if (!this.renderTile(dataZoomLevel, row, col, tileX, tileY, tileW, tileH)) {
          this.renderFallback(dataZoomLevel, row, col, tileX, tileY, tileW, tileH);
        }
      }
    }
  }

  /**
   * Check if a tile is visible within the canvas bounds
   */
  private isTileVisible(
    tileX: number,
    tileY: number,
    tileSize: number,
    canvasWidth: number,
    canvasHeight: number,
  ): boolean {
    return (
      tileX >= -tileSize && tileX <= canvasWidth && tileY >= -tileSize && tileY <= canvasHeight
    );
  }

  /**
   * Clear the tile cache
   */
  clearCache(): void {
    this.tileCache.clear();
    this.clearTextureCache();
  }

  /**
   * Clear only the texture cache (keeps tile data)
   */
  private clearTextureCache(): void {
    if (this.renderer) {
      for (const texture of this.textureCache.values()) {
        this.renderer.deleteTileTexture(texture);
      }
    }
    this.textureCache.clear();
  }

  /**
   * Look up a tile in the cache without triggering a fetch.
   * Returns undefined if the tile is not currently cached.
   */
  getCachedTile(level: number, row: number, col: number): Tile | undefined {
    return this.tileCache.get(TileCache.makeKey(level, row, col));
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { tileCount: number; textureCount: number } {
    return {
      tileCount: this.tileCache.size,
      textureCount: this.textureCache.size,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clearCache();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
