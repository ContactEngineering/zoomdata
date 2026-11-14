import { describe, it, expect } from 'vitest';
import { TileCache, type TileCacheOptions } from './TileCache';
import type { Tile } from './Tile';

function fakeTile(bytes = 1): Tile {
  return { byteSize: () => bytes } as Tile;
}

function makeCache(maxBytes?: number, options: TileCacheOptions = {}): TileCache {
  return new TileCache({ maxBytes, ...options });
}

describe('TileCache', () => {
  describe('constructor', () => {
    it('starts empty', () => {
      const c = makeCache(10);
      expect(c.size).toBe(0);
      expect(c.bytes).toBe(0);
    });

    it('throws when maxBytes is not positive', () => {
      expect(() => makeCache(0)).toThrow('maxBytes must be positive');
      expect(() => makeCache(-1)).toThrow('maxBytes must be positive');
    });

    it('defaults to a budget of 256 MiB', () => {
      expect(new TileCache().maxBytes).toBe(256 * 1024 * 1024);
    });
  });

  describe('makeKey', () => {
    it('formats as zoomLevel/row_column', () => {
      expect(TileCache.makeKey(5, 3, 7)).toBe('5/3_7');
    });

    it('handles zero values', () => {
      expect(TileCache.makeKey(0, 0, 0)).toBe('0/0_0');
    });
  });

  describe('set and get', () => {
    it('stores and retrieves a tile by key', () => {
      const cache = makeCache(10);
      const tile = fakeTile();
      cache.set('key', tile);
      expect(cache.get('key')).toBe(tile);
    });

    it('returns undefined for a missing key', () => {
      const cache = makeCache(10);
      expect(cache.get('missing')).toBeUndefined();
    });

    it('increments size on new keys', () => {
      const cache = makeCache(10);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      expect(cache.size).toBe(2);
    });

    it('replaces value without growing size when key already exists', () => {
      const cache = makeCache(10);
      const t1 = fakeTile();
      const t2 = fakeTile();
      cache.set('a', t1);
      cache.set('a', t2);
      expect(cache.size).toBe(1);
      expect(cache.get('a')).toBe(t2);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the oldest entry when at capacity', () => {
      const cache = makeCache(3);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      cache.set('c', fakeTile());
      cache.set('d', fakeTile());
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('get() promotes entry to MRU so it is not evicted next', () => {
      const cache = makeCache(3);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      cache.set('c', fakeTile());
      cache.get('a'); // 'a' becomes MRU; 'b' is now LRU
      cache.set('d', fakeTile());
      expect(cache.has('b')).toBe(false);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('set() on existing key promotes it to MRU', () => {
      const cache = makeCache(3);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      cache.set('c', fakeTile());
      cache.set('a', fakeTile()); // 'a' becomes MRU; 'b' is now LRU
      cache.set('d', fakeTile());
      expect(cache.has('b')).toBe(false);
      expect(cache.has('a')).toBe(true);
    });

    it('evicts entries in FIFO order when no get() calls', () => {
      const cache = makeCache(2);
      cache.set('first', fakeTile());
      cache.set('second', fakeTile());
      cache.set('third', fakeTile());
      expect(cache.has('first')).toBe(false);
      cache.set('fourth', fakeTile());
      expect(cache.has('second')).toBe(false);
    });
  });

  describe('has', () => {
    it('returns true for an existing key', () => {
      const cache = makeCache(10);
      cache.set('x', fakeTile());
      expect(cache.has('x')).toBe(true);
    });

    it('returns false for a missing key', () => {
      expect(makeCache(10).has('x')).toBe(false);
    });

    it('returns false after the key is deleted', () => {
      const cache = makeCache(10);
      cache.set('x', fakeTile());
      cache.delete('x');
      expect(cache.has('x')).toBe(false);
    });
  });

  describe('delete', () => {
    it('returns true and removes the entry when key exists', () => {
      const cache = makeCache(10);
      cache.set('x', fakeTile());
      expect(cache.delete('x')).toBe(true);
      expect(cache.size).toBe(0);
    });

    it('returns false when key does not exist', () => {
      expect(makeCache(10).delete('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = makeCache(10);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(false);
    });
  });

  describe('iteration', () => {
    it('entries() yields key-value pairs in insertion order', () => {
      const cache = makeCache(10);
      const t1 = fakeTile();
      const t2 = fakeTile();
      cache.set('a', t1);
      cache.set('b', t2);
      expect([...cache.entries()]).toEqual([
        ['a', t1],
        ['b', t2],
      ]);
    });

    it('keys() yields all keys in insertion order', () => {
      const cache = makeCache(10);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      expect([...cache.keys()]).toEqual(['a', 'b']);
    });

    it('values() yields all tiles in insertion order', () => {
      const cache = makeCache(10);
      const t1 = fakeTile();
      const t2 = fakeTile();
      cache.set('a', t1);
      cache.set('b', t2);
      expect([...cache.values()]).toEqual([t1, t2]);
    });

    it('entries() reflects MRU order after a get()', () => {
      const cache = makeCache(10);
      const ta = fakeTile();
      const tb = fakeTile();
      cache.set('a', ta);
      cache.set('b', tb);
      cache.get('a'); // promotes 'a' to MRU
      // Map iteration order: oldest first → 'b', then 'a'
      expect([...cache.keys()]).toEqual(['b', 'a']);
    });
  });

  describe('byte budget', () => {
    it('evicts by bytes, not by count', () => {
      const c = makeCache(100);
      c.set('a', fakeTile(60));
      c.set('b', fakeTile(30));
      c.set('c', fakeTile(5));
      expect(c.bytes).toBe(95);
      c.set('d', fakeTile(20));
      expect([...c.keys()]).toEqual(['b', 'c', 'd']);
      expect(c.bytes).toBe(55);
    });

    it('accounts for size changes and evicts then', () => {
      let size = 0;
      const growing = { byteSize: () => size } as Tile;
      const c = makeCache(100);
      c.set('a', fakeTile(50));
      c.set('b', growing);
      expect(c.bytes).toBe(50);
      size = 80;
      c.updateSize('b');
      expect([...c.keys()]).toEqual(['b']);
      expect(c.bytes).toBe(80);
    });

    it('uses sizeOf to include GPU memory', () => {
      const gpu = new Map([['a', 40]]);
      const c = makeCache(100, { sizeOf: (key, tile) => tile.byteSize() + (gpu.get(key) ?? 0) });
      c.set('a', fakeTile(10));
      expect(c.bytes).toBe(50);
    });

    it('never evicts the newest tile, even if it alone exceeds the budget', () => {
      const c = makeCache(10);
      c.set('a', fakeTile(5));
      c.set('big', fakeTile(50));
      expect([...c.keys()]).toEqual(['big']);
    });

    it('releases bytes on delete and clear', () => {
      const c = makeCache(100);
      c.set('a', fakeTile(10));
      c.set('b', fakeTile(20));
      c.delete('a');
      expect(c.bytes).toBe(20);
      c.clear();
      expect(c.bytes).toBe(0);
    });

    it('replacing a tile replaces its bytes', () => {
      const c = makeCache(100);
      c.set('a', fakeTile(10));
      c.set('a', fakeTile(30));
      expect(c.bytes).toBe(30);
    });
  });

  describe('pinning', () => {
    it('never evicts pinned tiles', () => {
      const c = makeCache(100, { isPinned: (key) => key.startsWith('0/') });
      c.set('0/0_0', fakeTile(40));
      c.set('5/0_0', fakeTile(40));
      c.set('5/0_1', fakeTile(40));
      expect([...c.keys()]).toEqual(['0/0_0', '5/0_1']);
    });

    it('may exceed the budget with pinned tiles alone', () => {
      const c = makeCache(50, { isPinned: () => true });
      c.set('a', fakeTile(40));
      c.set('b', fakeTile(40));
      expect(c.size).toBe(2);
      expect(c.bytes).toBe(80);
    });
  });

  describe('eviction callback', () => {
    it('reports evicted tiles, oldest first', () => {
      const evicted: string[] = [];
      const c = makeCache(2);
      c.onEvict = (key) => evicted.push(key);
      c.set('a', fakeTile());
      c.set('b', fakeTile());
      c.set('c', fakeTile());
      c.set('d', fakeTile());
      expect(evicted).toEqual(['a', 'b']);
    });

    it('is not called for delete and clear', () => {
      const evicted: string[] = [];
      const c = makeCache(10);
      c.onEvict = (key) => evicted.push(key);
      c.set('a', fakeTile());
      c.delete('a');
      c.set('b', fakeTile());
      c.clear();
      expect(evicted).toEqual([]);
    });
  });
});
