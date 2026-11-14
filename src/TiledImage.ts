import type { ZoomConfiguration } from './ZoomConfiguration';
import type { PixelRect, TileAddress } from './PyramidGeometry';
import { Tile } from './Tile';
import { TileCache } from './TileCache';
import {
  WebGLRenderer,
  type RendererColors,
  type TileTexture,
  type ViewTransform,
} from './WebGLRenderer';
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
  private colorRange: [number, number] = [0, 1];

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
    this.tileCache.onEvict = (key) => this.deleteTexture(key);
  }

  /**
   * Initialize the WebGL renderer for a canvas
   */
  initRenderer(
    canvas: HTMLCanvasElement,
    palette: number[],
    minValue: number,
    maxValue: number,
    colors: RendererColors = {},
  ): void {
    this.renderer = new WebGLRenderer(canvas, palette, colors);
    this.colorRange = [minValue, maxValue];
    // Textures died with the context; re-upload from the CPU cache on demand
    this.renderer.onContextRestored = () => {
      this.textureCache.clear();
      this.onTilesLoaded?.();
    };
  }

  /**
   * Update the color palette
   */
  setPalette(palette: number[]): void {
    this.renderer?.setPalette(palette);
  }

  /**
   * Update the value range mapped onto the palette, in physical units.
   * Tile textures hold stored values and are not re-uploaded.
   */
  setValueRange(minValue: number, maxValue: number): void {
    this.colorRange = [minValue, maxValue];
  }

  /**
   * Level whose resolution best matches the view scale k (screen pixels per
   * image pixel)
   */
  levelForScale(k: number): number {
    const max = this.config.maxZoomLevel;
    return Math.max(0, Math.min(max, Math.round(max + Math.log2(k))));
  }

  private deleteTexture(key: string): void {
    const texture = this.textureCache.get(key);
    if (texture) {
      this.renderer?.deleteTileTexture(texture);
      this.textureCache.delete(key);
    }
  }

  /**
   * Get or create a WebGL texture for a tile
   */
  private getTileTexture(tile: Tile, cacheKey: string): TileTexture | null {
    if (!this.renderer) return null;
    const cached = this.textureCache.get(cacheKey);
    if (cached) return cached;
    const data = tile.getData();
    if (!data) return null;
    const texture = this.renderer.createTileTexture(data, tile.width, tile.height);
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  /**
   * Get or fetch a tile, starting the fetch if needed
   */
  private getOrFetchTile({ level, col, row }: TileAddress): Tile {
    const cacheKey = TileCache.makeKey(level, row, col);
    let tile = this.tileCache.get(cacheKey);

    if (!tile) {
      const source = this.config.source;
      const extent = this.config.geometry.tileExtent(level, col, row);
      tile = new Tile(() => source.tileUrl(level, col, row), {
        expectedShape: { width: extent.x1 - extent.x0, height: extent.y1 - extent.y0 },
        encoding: this.config.descriptor.encoding,
      });
      this.tileCache.set(cacheKey, tile);
    }

    if (tile.getState() === TileState.Pending) {
      const done = () => this.onTilesLoaded?.();
      tile.fetch().then(done, done);
    }

    return tile;
  }

  /**
   * Draw the part `clip` (image pixels) of the image from a ready tile
   */
  private drawTile(tile: Tile, address: TileAddress, clip: PixelRect): boolean {
    if (!this.renderer || !tile.isReady()) return false;
    const { level, col, row } = address;
    const texture = this.getTileTexture(tile, TileCache.makeKey(level, row, col));
    if (!texture) return false;
    const geometry = this.config.geometry;
    const extent = geometry.tileExtent(level, col, row);
    const { scaleFactor, addOffset } = tile.getEncoding();
    // t = (h - min) / (max - min) with h = addOffset + scaleFactor * v
    const [min, max] = this.colorRange;
    const width = max - min;
    this.renderer.drawTile(texture, {
      stride: geometry.stride(level),
      originX: extent.x0,
      originY: extent.y0,
      clip,
      scale: width > 0 ? scaleFactor / width : 0,
      offset: width > 0 ? (addOffset - min) / width : 0,
    });
    return true;
  }

  /** Part of the image a tile's core covers, in image pixels */
  private coreInImage({ level, col, row }: TileAddress): PixelRect {
    const geometry = this.config.geometry;
    const core = geometry.tileCore(level, col, row);
    const s = geometry.stride(level);
    return {
      x0: core.x0 * s,
      y0: core.y0 * s,
      x1: Math.min(core.x1 * s, geometry.width),
      y1: Math.min(core.y1 * s, geometry.height),
    };
  }

  /**
   * Draw the region of a missing tile from the nearest cached coarser level
   */
  private drawFallback(address: TileAddress, clip: PixelRect): boolean {
    const geometry = this.config.geometry;
    for (let level = address.level - 1; level >= 0; level--) {
      // Tile cores at coarser levels contain whole cores of finer levels
      const s = geometry.stride(level);
      const parent = geometry.tileAt(level, clip.x0 / s, clip.y0 / s);
      const tile = this.tileCache.get(TileCache.makeKey(level, parent.row, parent.col));
      if (tile && this.drawTile(tile, parent, clip)) return true;
    }
    return false;
  }

  /**
   * Render the view `screen = k * image + (tx, ty)` to the canvas
   */
  render(canvas: HTMLCanvasElement, view: ViewTransform): void {
    if (!this.renderer) {
      throw new Error('TiledImage.render: renderer not initialized');
    }
    this.renderer.beginFrame(view);

    const { k, tx, ty } = view;
    const level = this.levelForScale(k);
    const visible = {
      x0: -tx / k,
      y0: -ty / k,
      x1: (canvas.width - tx) / k,
      y1: (canvas.height - ty) / k,
    };
    for (const address of this.config.geometry.tilesInRect(level, visible)) {
      const tile = this.getOrFetchTile(address);
      const clip = this.coreInImage(address);
      if (!this.drawTile(tile, address, clip)) {
        this.drawFallback(address, clip);
      }
    }
  }

  /**
   * Render the tiled image to a canvas
   * @deprecated Use render() with a view transform
   */
  renderTo(
    canvas: HTMLCanvasElement,
    xPos: number,
    yPos: number,
    fractionalZoomLevel: number,
  ): void {
    const k = 1 / this.config.scaleFactorAtZoomLevel(fractionalZoomLevel);
    this.render(canvas, { k, tx: xPos, ty: yPos });
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
