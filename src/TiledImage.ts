import type { ColorMapper } from './ColorMapper';
import type { ZoomConfiguration } from './ZoomConfiguration';
import { Tile } from './Tile';
import { TileCache } from './TileCache';
import type { RenderCallback } from './types';

/**
 * Manages rendering of a tiled zoomable image.
 * Handles tile caching and visibility culling for efficient rendering.
 */
export class TiledImage {
  private readonly config: ZoomConfiguration;
  private readonly colorMapper: ColorMapper;
  private readonly tileCache: TileCache;
  private readonly debug: boolean;

  /** Callback invoked when tiles finish loading and need re-render */
  onTilesLoaded: RenderCallback | null = null;

  /**
   * Create a new TiledImage
   * @param config - The zoom configuration
   * @param colorMapper - Color mapper for rendering tiles
   * @param maxCacheSize - Maximum number of tiles to cache (default: 100)
   * @param debug - Enable debug rendering (default: false)
   */
  constructor(
    config: ZoomConfiguration,
    colorMapper: ColorMapper,
    maxCacheSize: number = 100,
    debug: boolean = false
  ) {
    this.config = config;
    this.colorMapper = colorMapper;
    this.tileCache = new TileCache(maxCacheSize);
    this.debug = debug;
  }

  /**
   * Calculate which integer zoom level to use for tile data.
   * Rounds to nearest level to minimize scaling artifacts.
   * @param fractionalZoomLevel - The current fractional zoom level
   * @returns Integer zoom level for tile data
   */
  private getDataZoomLevel(fractionalZoomLevel: number): number {
    const rounded = Math.round(fractionalZoomLevel);
    return Math.max(0, Math.min(this.config.maxZoomLevel, rounded));
  }

  /**
   * Calculate the data scale factor for a given fractional zoom level.
   * This replaces the original switch statement with a simple formula.
   * @param fractionalZoomLevel - The current fractional zoom level
   * @returns Scale factor for data tiles
   */
  private getDataScaleFactor(fractionalZoomLevel: number): number {
    // Round to nearest 0.5 level, then compute 2^(maxLevel - roundedLevel)
    const levelDiff = this.config.maxZoomLevel - fractionalZoomLevel;
    const roundedDiff = Math.floor(levelDiff + 0.5);

    // Clamp to valid range
    const clampedDiff = Math.max(0, roundedDiff);

    // Calculate scale factor as power of 2
    const dataScaleFactor = Math.pow(2, clampedDiff);

    // Limit to maximum scale factor (when image fits in one tile)
    const maxScaleFactor = this.config.imageSize.Width / this.config.tileSize;

    return Math.min(dataScaleFactor, maxScaleFactor);
  }

  /**
   * Render the tiled image to a canvas
   * @param canvas - The canvas element to render to
   * @param xPos - X offset in canvas coordinates
   * @param yPos - Y offset in canvas coordinates
   * @param fractionalZoomLevel - Current zoom level (can be fractional)
   */
  renderTo(
    canvas: HTMLCanvasElement,
    xPos: number,
    yPos: number,
    fractionalZoomLevel: number
  ): void {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('TiledImage.renderTo: failed to get 2D context');
    }

    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate scale factors
    const displayScaleFactor = this.config.scaleFactorAtZoomLevel(fractionalZoomLevel);
    const dataScaleFactor = this.getDataScaleFactor(fractionalZoomLevel);
    const dataZoomLevel = this.getDataZoomLevel(fractionalZoomLevel);

    // Calculate number of tiles at this data zoom level
    const numColumns = Math.ceil(
      this.config.imageSize.Width / (dataScaleFactor * this.config.tileSize)
    );
    const numRows = Math.ceil(
      this.config.imageSize.Height / (dataScaleFactor * this.config.tileSize)
    );

    // Calculate rendered tile size on screen
    const scaledTileSize = this.config.tileSize * (dataScaleFactor / displayScaleFactor);

    // Track if any tiles are still loading
    let tilesLoading = 0;

    // Render visible tiles
    for (let col = 0; col < numColumns; col++) {
      for (let row = 0; row < numRows; row++) {
        // Round positions to avoid sub-pixel gaps between tiles
        const tileX = Math.round(xPos + col * scaledTileSize);
        const tileY = Math.round(yPos + row * scaledTileSize);

        // Skip tiles outside visible area
        if (!this.isTileVisible(tileX, tileY, scaledTileSize, canvas.width, canvas.height)) {
          continue;
        }

        // Get or create tile
        const cacheKey = TileCache.makeKey(dataZoomLevel, row, col);
        let tile = this.tileCache.get(cacheKey);

        if (!tile) {
          const url = this.config.getTileUrl(dataZoomLevel, row, col);
          tile = new Tile(this.colorMapper, url);
          this.tileCache.set(cacheKey, tile);
        }

        // Render tile (round size to match rounded positions)
        const roundedTileSize = Math.round(scaledTileSize);
        const rendered = tile.renderTo(
          context,
          tileX,
          tileY,
          roundedTileSize,
          roundedTileSize,
          this.debug
        );

        if (!rendered && !tile.getError()) {
          tilesLoading++;

          // Set up callback to re-render when tile loads
          tile.fetch().then(() => {
            if (this.onTilesLoaded) {
              this.onTilesLoaded();
            }
          }).catch(() => {
            // Error is handled by tile.getError()
            if (this.onTilesLoaded) {
              this.onTilesLoaded();
            }
          });
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
    canvasHeight: number
  ): boolean {
    return (
      tileX >= -tileSize &&
      tileX <= canvasWidth &&
      tileY >= -tileSize &&
      tileY <= canvasHeight
    );
  }

  /**
   * Clear the tile cache
   */
  clearCache(): void {
    this.tileCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number } {
    return {
      size: this.tileCache.size,
    };
  }
}
