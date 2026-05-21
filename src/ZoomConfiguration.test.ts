import { describe, it, expect, afterEach, vi } from 'vitest';
import { ZoomConfiguration } from './ZoomConfiguration';
import type { DZIMetadata } from './types';

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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: () => Promise.resolve(data),
  }));
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
    it('appends a trailing slash when missing', () => {
      const config = new ZoomConfiguration('http://example.com/data');
      expect(config.rootUrl).toBe('http://example.com/data/');
    });

    it('preserves a trailing slash when already present', () => {
      const config = new ZoomConfiguration('http://example.com/data/');
      expect(config.rootUrl).toBe('http://example.com/data/');
    });

    it('derives baseUrl as rootUrl + dzdata_files/', () => {
      const config = new ZoomConfiguration('http://example.com/data/');
      expect(config.baseUrl).toBe('http://example.com/data/dzdata_files/');
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
      expect(() => new ZoomConfiguration('http://example.com/').colorbarRange).toThrow('not loaded');
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
      const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(VALID_METADATA) });
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
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow('HTTP 404');
    });

    it('throws when Image field is missing', async () => {
      stubFetch({});
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow('"Image" field');
    });

    it('throws when Image.Size is missing', async () => {
      stubFetch({ Image: { TileSize: 256 } });
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow('"Image.Size"');
    });

    it('throws when Image.TileSize is missing', async () => {
      stubFetch({ Image: { Size: { Width: 256, Height: 256 } } });
      await expect(new ZoomConfiguration('http://example.com/').fetch()).rejects.toThrow('"Image.TileSize"');
    });
  });

  describe('scaleFactorAtZoomLevel()', () => {
    it('returns 1 at maxZoomLevel (pixel-perfect)', async () => {
      expect((await loadedConfig()).scaleFactorAtZoomLevel(12)).toBe(1);
    });

    it('doubles per level below max', async () => {
      const config = await loadedConfig();
      expect(config.scaleFactorAtZoomLevel(11)).toBe(2);
      expect(config.scaleFactorAtZoomLevel(10)).toBe(4);
      expect(config.scaleFactorAtZoomLevel(9)).toBe(8);
    });

    it('returns 2^maxZoom at level 0 (fully zoomed out)', async () => {
      const config = await loadedConfig();
      expect(config.scaleFactorAtZoomLevel(0)).toBe(4096); // 2^12
    });
  });

  describe('getNumColumns() and getNumRows()', () => {
    it('returns 16 columns at maxZoomLevel (4096px / 256px tiles)', async () => {
      expect((await loadedConfig()).getNumColumns(12)).toBe(16);
    });

    it('halves column count per level below max', async () => {
      const config = await loadedConfig();
      expect(config.getNumColumns(11)).toBe(8);
      expect(config.getNumColumns(10)).toBe(4);
    });

    it('returns 8 rows at maxZoomLevel (2048px / 256px tiles)', async () => {
      expect((await loadedConfig()).getNumRows(12)).toBe(8);
    });

    it('ceils when image is not a multiple of tile size', async () => {
      // Width=300, TileSize=256 → maxZoomLevel = ceil(log2(300)) = 9
      // At level 9: scaleFactor=1, cols = ceil(300/256) = 2
      stubFetch({ Image: { Size: { Width: 300, Height: 256 }, TileSize: 256, Overlap: 0 } });
      const config = new ZoomConfiguration('http://example.com/');
      await config.fetch();
      expect(config.getNumColumns(config.maxZoomLevel)).toBe(2);
    });
  });

  describe('clampZoomLevel()', () => {
    it('returns the value unchanged when within [0, maxZoomLevel]', async () => {
      expect((await loadedConfig()).clampZoomLevel(6)).toBe(6);
    });

    it('clamps to 0 below the minimum', async () => {
      expect((await loadedConfig()).clampZoomLevel(-5)).toBe(0);
    });

    it('clamps to maxZoomLevel above the maximum', async () => {
      expect((await loadedConfig()).clampZoomLevel(999)).toBe(12);
    });

    it('accepts 0 exactly', async () => {
      expect((await loadedConfig()).clampZoomLevel(0)).toBe(0);
    });

    it('accepts maxZoomLevel exactly', async () => {
      expect((await loadedConfig()).clampZoomLevel(12)).toBe(12);
    });
  });

  describe('getTileUrl()', () => {
    it('builds URL with column_row filename per DZI convention', async () => {
      const config = await loadedConfig('http://example.com/data/');
      // row=3, column=5 → filename is "5_3.nc" (column first)
      expect(config.getTileUrl(12, 3, 5)).toBe('http://example.com/data/dzdata_files/12/5_3.nc');
    });

    it('includes the zoom level in the path', async () => {
      const config = await loadedConfig('http://example.com/data/');
      expect(config.getTileUrl(7, 0, 0)).toBe('http://example.com/data/dzdata_files/7/0_0.nc');
    });
  });
});
