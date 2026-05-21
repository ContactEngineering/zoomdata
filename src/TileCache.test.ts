import { describe, it, expect } from 'vitest';
import { TileCache } from './TileCache';
import type { Tile } from './Tile';

function fakeTile(): Tile {
  return {} as Tile;
}

describe('TileCache', () => {
  describe('constructor', () => {
    it('starts empty', () => {
      const cache = new TileCache(10);
      expect(cache.size).toBe(0);
    });

    it('throws when maxSize is 0', () => {
      expect(() => new TileCache(0)).toThrow('maxSize must be at least 1');
    });

    it('throws when maxSize is negative', () => {
      expect(() => new TileCache(-1)).toThrow('maxSize must be at least 1');
    });

    it('default maxSize is 100', () => {
      const cache = new TileCache();
      for (let i = 0; i < 100; i++) cache.set(String(i), fakeTile());
      expect(cache.size).toBe(100);
      cache.set('overflow', fakeTile());
      expect(cache.size).toBe(100);
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
      const cache = new TileCache(10);
      const tile = fakeTile();
      cache.set('key', tile);
      expect(cache.get('key')).toBe(tile);
    });

    it('returns undefined for a missing key', () => {
      const cache = new TileCache(10);
      expect(cache.get('missing')).toBeUndefined();
    });

    it('increments size on new keys', () => {
      const cache = new TileCache(10);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      expect(cache.size).toBe(2);
    });

    it('replaces value without growing size when key already exists', () => {
      const cache = new TileCache(10);
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
      const cache = new TileCache(3);
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
      const cache = new TileCache(3);
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
      const cache = new TileCache(3);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      cache.set('c', fakeTile());
      cache.set('a', fakeTile()); // 'a' becomes MRU; 'b' is now LRU
      cache.set('d', fakeTile());
      expect(cache.has('b')).toBe(false);
      expect(cache.has('a')).toBe(true);
    });

    it('evicts entries in FIFO order when no get() calls', () => {
      const cache = new TileCache(2);
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
      const cache = new TileCache(10);
      cache.set('x', fakeTile());
      expect(cache.has('x')).toBe(true);
    });

    it('returns false for a missing key', () => {
      expect(new TileCache(10).has('x')).toBe(false);
    });

    it('returns false after the key is deleted', () => {
      const cache = new TileCache(10);
      cache.set('x', fakeTile());
      cache.delete('x');
      expect(cache.has('x')).toBe(false);
    });
  });

  describe('delete', () => {
    it('returns true and removes the entry when key exists', () => {
      const cache = new TileCache(10);
      cache.set('x', fakeTile());
      expect(cache.delete('x')).toBe(true);
      expect(cache.size).toBe(0);
    });

    it('returns false when key does not exist', () => {
      expect(new TileCache(10).delete('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new TileCache(10);
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
      const cache = new TileCache(10);
      const t1 = fakeTile();
      const t2 = fakeTile();
      cache.set('a', t1);
      cache.set('b', t2);
      expect([...cache.entries()]).toEqual([['a', t1], ['b', t2]]);
    });

    it('keys() yields all keys in insertion order', () => {
      const cache = new TileCache(10);
      cache.set('a', fakeTile());
      cache.set('b', fakeTile());
      expect([...cache.keys()]).toEqual(['a', 'b']);
    });

    it('values() yields all tiles in insertion order', () => {
      const cache = new TileCache(10);
      const t1 = fakeTile();
      const t2 = fakeTile();
      cache.set('a', t1);
      cache.set('b', t2);
      expect([...cache.values()]).toEqual([t1, t2]);
    });

    it('entries() reflects MRU order after a get()', () => {
      const cache = new TileCache(10);
      const ta = fakeTile();
      const tb = fakeTile();
      cache.set('a', ta);
      cache.set('b', tb);
      cache.get('a'); // promotes 'a' to MRU
      // Map iteration order: oldest first → 'b', then 'a'
      expect([...cache.keys()]).toEqual(['b', 'a']);
    });
  });
});
