import type { ZoomConfiguration } from './ZoomConfiguration';
import type { PixelRect, TileAddress } from './PyramidGeometry';
import { sampleAt, type Sample } from './sampling';
import { Tile } from './Tile';
import { TileCache } from './TileCache';
import { TileLoader, type TileLoaderOptions, type TileRequest } from './TileLoader';
import {
  WebGLRenderer,
  type RendererColors,
  type TileTexture,
  type ViewTransform,
} from './WebGLRenderer';
import type { RenderCallback } from './types';

/**
 * Manages rendering of a tiled zoomable image using WebGL.
 * Handles tile caching, GPU texture management, and fallback rendering.
 */
export class TiledImage {
  private readonly config: ZoomConfiguration;
  private readonly tileCache: TileCache;

  private readonly loader: TileLoader;
  private renderer: WebGLRenderer | null = null;
  private textureCache: Map<string, TileTexture> = new Map();
  private colorRange: [number, number] = [0, 1];
  // Keys of the tiles the last rendered view shows or helpers asked for
  private viewTiles: Set<string> = new Set();
  // Tiles wanted beyond the view, by owner
  private extraTiles = new Map<string, TileAddress[]>();

  /** Callback invoked when tiles finish loading and need re-render */
  onTilesLoaded: RenderCallback | null = null;

  /**
   * Create a new TiledImage
   * @param config - The zoom configuration
   * @param cacheBytes - Memory budget for tiles, CPU and GPU (default: 256 MiB)
   * @param loaderOptions - Concurrency and retries of tile requests
   */
  constructor(config: ZoomConfiguration, cacheBytes?: number, loaderOptions?: TileLoaderOptions) {
    this.config = config;
    const baseLevel = config.geometry.baseLevel;
    this.tileCache = new TileCache({
      maxBytes: cacheBytes,
      sizeOf: (key, tile) => tile.byteSize() + (this.textureCache.get(key)?.bytes ?? 0),
      // Never evict the base level, so there is always something to draw,
      // nor the tiles of the current view: evicting those would refetch
      // them on the next frame, forever, if they exceed the budget
      isPinned: (key) =>
        Number(key.slice(0, key.indexOf('/'))) <= baseLevel || this.viewTiles.has(key),
    });
    this.tileCache.onEvict = (key, tile) => {
      this.deleteTexture(key);
      tile.clearCache();
    };
    this.loader = new TileLoader(config.source, loaderOptions);
    this.loader.onSettled = (request) => {
      this.tileCache.updateSize(request.key);
      this.onTilesLoaded?.();
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
    this.tileCache.updateSize(cacheKey);
    return texture;
  }

  /**
   * Get a tile from the cache, creating it (pending) if needed
   */
  private getOrCreateTile({ level, col, row }: TileAddress): Tile {
    const cacheKey = TileCache.makeKey(level, row, col);
    let tile = this.tileCache.get(cacheKey);
    if (!tile) {
      const extent = this.config.geometry.tileExtent(level, col, row);
      tile = new Tile({
        expectedShape: { width: extent.x1 - extent.x0, height: extent.y1 - extent.y0 },
        encoding: this.config.descriptor.encoding,
      });
      this.tileCache.set(cacheKey, tile);
    }
    return tile;
  }

  private request(address: TileAddress, priority: number): TileRequest {
    return {
      key: TileCache.makeKey(address.level, address.row, address.col),
      ...address,
      priority,
      tile: this.getOrCreateTile(address),
    };
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
    const geometry = this.config.geometry;
    const addresses = geometry.tilesInRect(level, visible);
    // Pin the tiles in view and those helpers asked for before touching the
    // cache, or they could be evicted and refetched
    this.viewTiles = new Set(
      [...addresses, ...[...this.extraTiles.values()].flat()].map((a) =>
        TileCache.makeKey(a.level, a.row, a.col),
      ),
    );

    // The base level loads first, then visible tiles from the centre out
    const requests: TileRequest[] = [];
    const base = geometry.baseLevel;
    if (level > base) {
      requests.push(this.request({ level: base, col: 0, row: 0 }, -1));
    }
    const cx = (visible.x0 + visible.x1) / 2;
    const cy = (visible.y0 + visible.y1) / 2;
    for (const address of addresses) {
      const clip = this.coreInImage(address);
      const dx = (clip.x0 + clip.x1) / 2 - cx;
      const dy = (clip.y0 + clip.y1) / 2 - cy;
      const request = this.request(address, dx * dx + dy * dy);
      requests.push(request);
      if (!this.drawTile(request.tile, address, clip)) {
        this.drawFallback(address, clip);
      }
    }
    // Tiles helpers need beyond the view load after the visible ones
    const wanted = new Set(requests.map((r) => r.key));
    let priority = Number.MAX_SAFE_INTEGER / 2;
    for (const addresses of this.extraTiles.values()) {
      for (const address of addresses) {
        const request = this.request(address, priority++);
        if (!wanted.has(request.key)) {
          wanted.add(request.key);
          requests.push(request);
        }
      }
    }
    this.loader.update(requests);
    // Tiles that left the view are no longer pinned
    this.tileCache.trim();
  }

  /**
   * Keep tiles loaded beyond the view, e.g. along a cross-section. Replaces
   * the tiles previously requested by the same owner.
   */
  setExtraTiles(owner: string, addresses: TileAddress[]): void {
    if (addresses.length === 0) this.extraTiles.delete(owner);
    else this.extraTiles.set(owner, addresses);
  }

  /**
   * Whether tiles are queued or loading
   */
  isLoading(): boolean {
    return !this.loader.idle;
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
   * Value at an image position from the finest level in memory; does not
   * fetch tiles or change their recency in the cache
   */
  sampleAt(imageX: number, imageY: number, maxLevel?: number): Sample | null {
    return sampleAt(
      this.config.geometry,
      (level, col, row) => this.tileCache.peek(TileCache.makeKey(level, row, col)),
      imageX,
      imageY,
      maxLevel,
    );
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { tileCount: number; textureCount: number; bytes: number } {
    return {
      tileCount: this.tileCache.size,
      textureCount: this.textureCache.size,
      bytes: this.tileCache.bytes,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.loader.dispose();
    this.clearCache();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
