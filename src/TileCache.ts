import type { Tile } from './Tile';

/**
 * LRU (Least Recently Used) cache for tiles with automatic eviction.
 * Uses a Map to maintain insertion/access order for efficient LRU tracking.
 */
export class TileCache {
  private cache: Map<string, Tile> = new Map();
  private readonly maxSize: number;

  /**
   * Create a new TileCache
   * @param maxSize - Maximum number of tiles to keep in cache (default: 100)
   */
  constructor(maxSize: number = 100) {
    if (maxSize < 1) {
      throw new Error('TileCache: maxSize must be at least 1');
    }
    this.maxSize = maxSize;
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
   * Get a tile from the cache
   * @param key - The cache key
   * @returns The tile if found, undefined otherwise
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
   * Check if a tile exists in the cache
   * @param key - The cache key
   * @returns True if the tile exists
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Add a tile to the cache, evicting oldest if necessary
   * @param key - The cache key
   * @param tile - The tile to cache
   */
  set(key: string, tile: Tile): void {
    // If key already exists, delete it first (will be re-added at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, tile);
  }

  /**
   * Remove a tile from the cache
   * @param key - The cache key
   * @returns True if the tile was removed
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all tiles from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of tiles in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Iterate over all tiles in the cache (oldest to newest)
   */
  *entries(): IterableIterator<[string, Tile]> {
    yield* this.cache.entries();
  }

  /**
   * Get all cache keys
   */
  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  /**
   * Get all cached tiles
   */
  values(): IterableIterator<Tile> {
    return this.cache.values();
  }
}
