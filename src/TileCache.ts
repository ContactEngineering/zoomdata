import type { Tile } from './Tile';

export interface TileCacheOptions {
  /** Memory budget in bytes (default: 256 MiB) */
  maxBytes?: number;
  /** Bytes held for a tile, CPU and GPU (default: the tile's own data) */
  sizeOf?: (key: string, tile: Tile) => number;
  /** Tiles that are never evicted, e.g. a coarse base level or the tiles in view */
  isPinned?: (key: string, tile: Tile) => boolean;
}

export const DEFAULT_CACHE_BYTES = 256 * 1024 * 1024;

/**
 * LRU (Least Recently Used) cache for tiles, bounded by the bytes they hold.
 * Uses a Map to maintain insertion/access order for efficient LRU tracking.
 *
 * Tile sizes change when tiles finish loading or get a texture; call
 * updateSize() then. The most recently set or updated tile and pinned tiles
 * are never evicted, so the cache may exceed its budget if they alone do.
 */
export class TileCache {
  private cache: Map<string, Tile> = new Map();
  private sizes: Map<string, number> = new Map();
  private totalBytes = 0;
  readonly maxBytes: number;
  private readonly sizeOf: (key: string, tile: Tile) => number;
  private readonly isPinned: (key: string, tile: Tile) => boolean;

  /** Called when a tile is evicted by the LRU policy. Not called for explicit delete/clear. */
  onEvict: ((key: string, tile: Tile) => void) | null = null;

  constructor(options: TileCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_CACHE_BYTES;
    if (!(this.maxBytes > 0)) {
      throw new Error('TileCache: maxBytes must be positive');
    }
    this.sizeOf = options.sizeOf ?? ((_key, tile) => tile.byteSize());
    this.isPinned = options.isPinned ?? (() => false);
  }

  /**
   * Generate a cache key for a tile
   * @param zoomLevel - The zoom level
   * @param row - The row index
   * @param column - The column index
   * @returns Cache key string
   */
  static makeKey(zoomLevel: number, row: number, column: number): string {
    return `${zoomLevel}/${row}_${column}`;
  }

  /**
   * Get a tile from the cache and mark it as recently used
   */
  get(key: string): Tile | undefined {
    const tile = this.cache.get(key);
    if (tile) {
      // Move to end (most recently used) by re-inserting
      this.cache.delete(key);
      this.cache.set(key, tile);
    }
    return tile;
  }

  /**
   * Get a tile without marking it as recently used
   */
  peek(key: string): Tile | undefined {
    return this.cache.get(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Add a tile, evicting least recently used tiles if over budget
   */
  set(key: string, tile: Tile): void {
    this.remove(key);
    this.cache.set(key, tile);
    this.account(key, tile);
    this.evict(key);
  }

  /**
   * Recompute the size of a tile (e.g. after it loaded or got a texture)
   * and evict others if over budget
   */
  updateSize(key: string): void {
    const tile = this.cache.get(key);
    if (!tile) return;
    this.account(key, tile);
    this.evict(key);
  }

  private account(key: string, tile: Tile): void {
    const bytes = this.sizeOf(key, tile);
    this.totalBytes += bytes - (this.sizes.get(key) ?? 0);
    this.sizes.set(key, bytes);
  }

  private remove(key: string): boolean {
    this.totalBytes -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
    return this.cache.delete(key);
  }

  /**
   * Evict tiles if over budget, e.g. after the set of pinned tiles changed
   */
  trim(): void {
    this.evict(null);
  }

  private evict(keep: string | null): void {
    if (this.totalBytes <= this.maxBytes) return;
    for (const [key, tile] of [...this.cache]) {
      if (this.totalBytes <= this.maxBytes) break;
      if (key === keep || this.isPinned(key, tile)) continue;
      this.remove(key);
      this.onEvict?.(key, tile);
    }
  }

  /**
   * Remove a tile from the cache
   * @returns True if the tile was removed
   */
  delete(key: string): boolean {
    return this.remove(key);
  }

  /**
   * Clear all tiles from the cache
   */
  clear(): void {
    this.cache.clear();
    this.sizes.clear();
    this.totalBytes = 0;
  }

  /** Number of tiles in the cache */
  get size(): number {
    return this.cache.size;
  }

  /** Bytes held by the tiles in the cache */
  get bytes(): number {
    return this.totalBytes;
  }

  /**
   * Iterate over all tiles in the cache (oldest to newest)
   */
  *entries(): IterableIterator<[string, Tile]> {
    yield* this.cache.entries();
  }

  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  values(): IterableIterator<Tile> {
    return this.cache.values();
  }
}
