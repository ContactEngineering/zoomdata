import { describe, it, expect, afterEach, vi } from 'vitest';
import { NetCDFReader } from './NetCDFReader.js';
import { StaticTileSource, type TileSource } from './TileSource.js';
import { ZarrSource } from './ZarrSource.js';
import { ZoomConfiguration } from './ZoomConfiguration.js';
import type { DZIMetadata } from './types.js';

const VALID_METADATA: DZIMetadata = {
  Image: {
    Size: { Width: 4096, Height: 2048 },
    TileSize: 256,
    Overlap: 1,
    ColorbarRange: { Minimum: -10.0, Maximum: 100.0 },
    ColorbarTitle: 'Height (m)',
    PixelsPerMeter: { Width: 1000, Height: 1000 },
  },
};

function stubFetch(data: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Not Found',
      json: () => Promise.resolve(data),
    }),
  );
}

async function loadedConfig(rootUrl = 'http://example.com/data/'): Promise<ZoomConfiguration> {
  stubFetch(VALID_METADATA);
  const config = new ZoomConfiguration(rootUrl);
  await config.fetch();
  return config;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ZoomConfiguration', () => {
  describe('constructor', () => {
    it('wraps a root URL in a StaticTileSource', () => {
      const config = new ZoomConfiguration('http://example.com/data');
      expect(config.reader).toBeInstanceOf(NetCDFReader);
      const source = (config.reader as NetCDFReader).source;
      expect(source).toBeInstanceOf(StaticTileSource);
      expect((source as StaticTileSource).rootUrl).toBe('http://example.com/data/');
    });

    it('reads a URL ending in .ozx as a zipped OME-Zarr pyramid', () => {
      const config = new ZoomConfiguration('http://example.com/data/pyramid.ozx?sig=1');
      expect(config.reader).toBeInstanceOf(ZarrSource);
    });

    it('uses a given tile source', async () => {
      const source: TileSource = {
        descriptor: () => Promise.resolve(VALID_METADATA),
        tileUrl: () => Promise.resolve(null),
      };
      const config = new ZoomConfiguration(source);
      await config.fetch();
      expect((config.reader as NetCDFReader).source).toBe(source);
      expect(config.imageSize).toEqual({ Width: 4096, Height: 2048 });
    });

    it('is not loaded initially', () => {
      expect(new ZoomConfiguration('http://example.com/').isLoaded).toBe(false);
    });
  });

  describe('accessors before load throw', () => {
    it('imageSize', () => {
      expect(() => new ZoomConfiguration('http://example.com/').imageSize).toThrow('not loaded');
    });

    it('tileSize', () => {
      expect(() => new ZoomConfiguration('http://example.com/').tileSize).toThrow('not loaded');
    });

    it('overlap', () => {
      expect(() => new ZoomConfiguration('http://example.com/').overlap).toThrow('not loaded');
    });

    it('maxZoomLevel', () => {
      expect(() => new ZoomConfiguration('http://example.com/').maxZoomLevel).toThrow('not loaded');
    });

    it('colorbarRange', () => {
      expect(() => new ZoomConfiguration('http://example.com/').colorbarRange).toThrow(
        'not loaded',
      );
    });
  });

  describe('fetch()', () => {
    it('marks the config as loaded', async () => {
      expect((await loadedConfig()).isLoaded).toBe(true);
    });

    it('parses imageSize, tileSize, and overlap', async () => {
      const config = await loadedConfig();
      expect(config.imageSize).toEqual({ Width: 4096, Height: 2048 });
      expect(config.tileSize).toBe(256);
      expect(config.overlap).toBe(1);
    });

    it('calculates maxZoomLevel as ceil(log2(max(width, height)))', async () => {
      const config = await loadedConfig();
      // max(4096, 2048) = 4096; log2(4096) = 12; ceil(12) = 12
      expect(config.maxZoomLevel).toBe(12);
    });

    it('uses height when it is the larger dimension', async () => {
      stubFetch({ Image: { Size: { Width: 100, Height: 2048 }, TileSize: 256, Overlap: 0 } });
      const config = new ZoomConfiguration('http://example.com/');
      await config.fetch();
      expect(config.maxZoomLevel).toBe(Math.ceil(Math.log2(2048)));
    });

    it('defaults overlap to 0 when absent', async () => {
      stubFetch({ Image: { Size: { Width: 256, Height: 256 }, TileSize: 256 } });
      const config = new ZoomConfiguration('http://example.com/');
      await config.fetch();
      expect(config.overlap).toBe(0);
    });

    it('parses optional colorbarRange', async () => {
      expect((await loadedConfig()).colorbarRange).toEqual({ Minimum: -10.0, Maximum: 100.0 });
    });

    it('returns null colorbarRange when absent from JSON', async () => {
      stubFetch({ Image: { Size: { Width: 256, Height: 256 }, TileSize: 256, Overlap: 0 } });
      const config = new ZoomConfiguration('http://example.com/');
      await config.fetch();
      expect(config.colorbarRange).toBeNull();
    });

    it('parses optional colorbarTitle', async () => {
      expect((await loadedConfig()).colorbarTitle).toBe('Height (m)');
    });

    it('defaults colorbarTitle to "Height" when absent', async () => {
      stubFetch({ Image: { Size: { Width: 256, Height: 256 }, TileSize: 256, Overlap: 0 } });
      const config = new ZoomConfiguration('http://example.com/');
      await config.fetch();
      expect(config.colorbarTitle).toBe('Height');
    });

    it('parses optional pixelsPerMeter', async () => {
      expect((await loadedConfig()).pixelsPerMeter).toEqual({ Width: 1000, Height: 1000 });
    });

    it('fetches from rootUrl + dzdata.json', async () => {
      const spy = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve(VALID_METADATA) });
      vi.stubGlobal('fetch', spy);
      await new ZoomConfiguration('http://example.com/data/').fetch();
      expect(spy).toHaveBeenCalledWith('http://example.com/data/dzdata.json');
    });

    it('returns the same instance for chaining', async () => {
      stubFetch(VALID_METADATA);
      const config = new ZoomConfiguration('http://example.com/');
      expect(await config.fetch()).toBe(config);
    });

    it('wraps HTTP errors', async () => {
      stubFetch({}, false, 404);
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow(
        'HTTP 404',
      );
    });

    it('throws when Image field is missing', async () => {
      stubFetch({});
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow(
        '"Image" field',
      );
    });

    it('throws when Image.Size is missing', async () => {
      stubFetch({ Image: { TileSize: 256 } });
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow(
        '"Image.Size"',
      );
    });

    it('throws when Image.TileSize is missing', async () => {
      stubFetch({ Image: { Size: { Width: 256, Height: 256 } } });
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow(
        '"Image.TileSize"',
      );
    });
  });
});
