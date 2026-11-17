import ZipFileStore from '@zarrita/storage/zip';
import type { Reader } from 'unzipit';
import * as zarr from 'zarrita';
import { HttpError } from './http.js';
import type { PyramidDescriptor } from './PyramidDescriptor.js';
import { PyramidGeometry } from './PyramidGeometry.js';
import type { PyramidReader } from './PyramidReader.js';
import type { DecodedTile, ValueEncoding } from './TileDecoder.js';
import type { ColorbarRange, ImageSize } from './types.js';

/**
 * Where a file is, for a URL that may expire (e.g. a presigned URL): `url`
 * returns the current URL, `invalidate` tells that it was rejected, so that
 * the next `url` call returns a fresh one.
 */
export interface UrlSource {
  url(): Promise<string>;
  invalidate?(): void;
}

export interface ZarrSourceOptions {
  /**
   * Pixels by which tiles extend beyond their core (default: 1). Chunks of
   * a Zarr array do not overlap; the reader assembles the overlap from the
   * neighbouring chunks.
   */
  overlap?: number;
  /** Memory budget for compressed chunks, in bytes (default: 64 MiB) */
  cacheBytes?: number;
  /**
   * Bytes fetched from the start of the file with the first request
   * (default: 64 KiB). The metadata comes first in the file, so this
   * usually fetches all of it at once.
   */
  prefixBytes?: number;
}

/** Version of the zoomdata attributes this reader understands */
const SUPPORTED_VERSION = 1;

/** Reads up to this size are kept: local file headers of the ZIP entries */
const SMALL_READ_BYTES = 64;

/** Metres per unit of OME-Zarr axes (UDUNITS-2 names) */
const OME_UNITS: Record<string, number> = {
  kilometer: 1e3,
  meter: 1,
  millimeter: 1e-3,
  micrometer: 1e-6,
  nanometer: 1e-9,
  angstrom: 1e-10,
  picometer: 1e-12,
  femtometer: 1e-15,
};

/** OME-Zarr axis units in the spelling of SurfaceTopography */
const UNIT_NAMES: Record<string, string> = {
  kilometer: 'km',
  meter: 'm',
  millimeter: 'mm',
  micrometer: 'um',
  nanometer: 'nm',
  angstrom: 'A',
  picometer: 'pm',
  femtometer: 'fm',
};

function fail(message: string): never {
  throw new Error(`Invalid Zarr pyramid: ${message}`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * Least-recently used cache of byte arrays within a budget, as the byte
 * cache of zarrita's `withByteCaching`
 */
class ByteCache {
  private readonly entries = new Map<string, Uint8Array | undefined>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): Uint8Array | undefined {
    const value = this.entries.get(key);
    if (this.entries.delete(key)) this.entries.set(key, value);
    return value;
  }

  set(key: string, value: Uint8Array | undefined): void {
    this.bytes -= this.entries.get(key)?.byteLength ?? 0;
    this.entries.delete(key);
    this.entries.set(key, value);
    this.bytes += value?.byteLength ?? 0;
    for (const [k, v] of this.entries) {
      if (this.bytes <= this.maxBytes || k === key) break;
      this.entries.delete(k);
      this.bytes -= v?.byteLength ?? 0;
    }
  }
}

interface Prefix {
  /** The first bytes of the file, or the whole file */
  bytes: Uint8Array<ArrayBuffer>;
  /** Size of the file */
  length: number;
  etag: string | null;
}

/**
 * Reads byte ranges of a file with HTTP range requests, for unzipit.
 *
 * The first request fetches the start of the file, which also tells its
 * size and ETag; later requests send `If-Match` with the ETag, so that a
 * file replaced on the server fails instead of mixing two versions. Errors
 * are thrown as HttpError, without retries; the TileLoader retries.
 *
 * The start of the file and the read that reaches its end (where unzipit
 * looks for the central directory) are kept, so that opening the archive
 * reads the metadata and the central directory from them.
 */
class RangeReader implements Reader {
  private prefix: Promise<Prefix> | null = null;
  private tail: { offset: number; bytes: Uint8Array<ArrayBuffer> } | null = null;
  private readonly small = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

  constructor(
    private readonly source: UrlSource,
    private readonly prefixBytes: number,
  ) {}

  async getLength(): Promise<number> {
    return (await this.loadPrefix()).length;
  }

  async read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
    const prefix = await this.loadPrefix();
    if (offset + length <= prefix.bytes.byteLength) {
      return prefix.bytes.subarray(offset, offset + length);
    }
    const tail = this.tail;
    if (tail && offset >= tail.offset) {
      return tail.bytes.subarray(offset - tail.offset, offset - tail.offset + length);
    }
    if (offset + length === prefix.length) {
      const bytes = await this.fetchRange(offset, length, prefix.etag);
      this.tail = { offset, bytes };
      return bytes;
    }
    if (length > SMALL_READ_BYTES) return this.fetchRange(offset, length, prefix.etag);
    // ZipFileStore reads the local header of an entry for every range of it
    const key = `${offset}:${length}`;
    let read = this.small.get(key);
    if (!read) {
      read = this.fetchRange(offset, length, prefix.etag);
      read.catch(() => this.small.delete(key));
      this.small.set(key, read);
    }
    return read;
  }

  private loadPrefix(): Promise<Prefix> {
    if (!this.prefix) {
      this.prefix = this.fetchPrefix();
      // A failed request is not kept, so that opening again tries again
      this.prefix.catch(() => (this.prefix = null));
    }
    return this.prefix;
  }

  private async fetchPrefix(): Promise<Prefix> {
    const response = await this.fetch(`bytes=0-${this.prefixBytes - 1}`, null);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const etag = response.headers.get('ETag');
    if (response.status !== 206) return { bytes, length: bytes.byteLength, etag };
    // Content-Range: bytes 0-65535/123456
    const total = /\/(\d+)\s*$/.exec(response.headers.get('Content-Range') ?? '');
    if (!total) {
      throw new Error(
        'The server did not state the size of the file; ' +
          'it must expose the Content-Range header to cross-origin requests',
      );
    }
    return { bytes, length: Number(total[1]), etag };
  }

  private async fetchRange(offset: number, length: number, etag: string | null) {
    const response = await this.fetch(`bytes=${offset}-${offset + length - 1}`, etag);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A server that ignores the range sends the whole file
    const data = response.status === 206 ? bytes : bytes.subarray(offset, offset + length);
    if (data.byteLength !== length) throw new Error(`Short read at ${offset}`);
    return data;
  }

  private async fetch(range: string, etag: string | null): Promise<Response> {
    const headers: Record<string, string> = { Range: range };
    if (etag) headers['If-Match'] = etag;
    const response = await fetch(await this.source.url(), { headers });
    if (response.status === 412) {
      throw new Error('The pyramid changed on the server; reload it');
    }
    if (!response.ok) throw new HttpError(response.status, response.statusText);
    return response;
  }
}

type Level = zarr.Array<'float32' | 'float64', zarr.AsyncReadable>;

interface Pyramid {
  descriptor: PyramidDescriptor;
  geometry: PyramidGeometry;
  /** Arrays by stride exponent: index 0 is the full resolution */
  levels: Level[];
  encodings: ValueEncoding[];
}

/**
 * Reader for a pyramid in a single file: a zipped OME-Zarr (`.ozx`) as
 * SurfaceTopography's `to_zarr_pyramid` writes it, read with HTTP range
 * requests (docs/pyramid-format.md).
 *
 * The file holds a Zarr v3 array per level, path "0" at full resolution
 * and each further path coarsened by two, with OME-Zarr multiscales and
 * zoomdata attributes in the root group. Tiles are the chunks of these
 * arrays, extended by `overlap` pixels from their neighbours.
 *
 * The server must answer range requests and expose the `Content-Range`
 * header to cross-origin requests (and `ETag`, to detect a changed file).
 */
export class ZarrSource implements PyramidReader {
  private readonly source: UrlSource;
  private readonly overlap: number;
  private readonly cacheBytes: number;
  private readonly prefixBytes: number;
  private pyramid: Promise<Pyramid> | null = null;

  /**
   * @param source - URL of the file, or a source of URLs that may expire
   * @param options - Overlap of the tiles and the cache budget
   */
  constructor(source: string | UrlSource, options: ZarrSourceOptions = {}) {
    this.source = typeof source === 'string' ? { url: async () => source } : source;
    this.overlap = options.overlap ?? 1;
    this.cacheBytes = options.cacheBytes ?? 64 * 1024 * 1024;
    this.prefixBytes = options.prefixBytes ?? 64 * 1024;
    if (!(Number.isInteger(this.overlap) && this.overlap >= 0)) {
      throw new Error(`Invalid overlap ${this.overlap}`);
    }
  }

  async descriptor(): Promise<PyramidDescriptor> {
    return (await this.open()).descriptor;
  }

  async readTile(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<DecodedTile> {
    const { geometry, levels, encodings, descriptor } = await this.open();
    const k = geometry.maxLevel - level;
    const array = levels[k];
    if (!array) throw new Error(`Level ${level} is not stored`);
    const e = geometry.tileExtent(level, col, row);
    // Requests are not aborted: they are coalesced with those of other
    // tiles, which an abort would cancel too
    signal?.throwIfAborted();
    const chunk = await zarr.get(array, [zarr.slice(e.y0, e.y1), zarr.slice(e.x0, e.x1)]);
    signal?.throwIfAborted();
    const data = chunk.data;
    return {
      width: e.x1 - e.x0,
      height: e.y1 - e.y0,
      values: data instanceof Float32Array ? data : Float32Array.from(data),
      encoding: encodings[k],
      unit: descriptor.unit,
      x: null,
      y: null,
    };
  }

  invalidate(): void {
    this.source.invalidate?.();
  }

  private open(): Promise<Pyramid> {
    if (!this.pyramid) {
      this.pyramid = this.load();
      // A failed open is not kept, so that opening again tries again
      this.pyramid.catch(() => (this.pyramid = null));
    }
    return this.pyramid;
  }

  private async load(): Promise<Pyramid> {
    const zip = new ZipFileStore(new RangeReader(this.source, this.prefixBytes));
    const store = zarr.withByteCaching(zarr.withRangeCoalescing(zip), {
      cache: new ByteCache(this.cacheBytes),
    });
    const root = await zarr.open.v3(store, { kind: 'group' });

    const ome = root.attrs.ome;
    const multiscales = isObject(ome) ? ome.multiscales : undefined;
    if (!Array.isArray(multiscales) || !isObject(multiscales[0])) {
      fail('missing OME-Zarr "multiscales"');
    }
    const multiscale = multiscales[0];
    const axes = multiscale.axes;
    if (
      !Array.isArray(axes) ||
      axes.length !== 2 ||
      !isObject(axes[0]) ||
      !isObject(axes[1]) ||
      axes[0].name !== 'y' ||
      axes[1].name !== 'x'
    ) {
      fail('axes must be (y, x)');
    }
    const datasets = multiscale.datasets;
    if (!Array.isArray(datasets) || datasets.length === 0) fail('no datasets');

    const levels: Level[] = [];
    const encodings: ValueEncoding[] = [];
    for (const dataset of datasets) {
      if (!isObject(dataset) || typeof dataset.path !== 'string') fail('dataset without path');
      const array = await zarr.open.v3(root.resolve(dataset.path), { kind: 'array' });
      if (!array.is('float32') && !array.is('float64')) {
        fail(`level "${dataset.path}" is ${array.dtype}, expected float32 or float64`);
      }
      levels.push(array);
      const { scale_factor: scale, add_offset: offset } = array.attrs;
      encodings.push({
        scaleFactor: isFiniteNumber(scale) ? scale : 1,
        addOffset: isFiniteNumber(offset) ? offset : 0,
      });
    }

    const [height, width] = levels[0].shape;
    const [tileSize, tileWidth] = levels[0].chunks;
    if (tileSize !== tileWidth) fail('chunks must be square');
    for (const [k, array] of levels.entries()) {
      const s = 2 ** k;
      const [h, w] = array.shape;
      if (h !== Math.ceil(height / s) || w !== Math.ceil(width / s)) {
        fail(
          `level ${k} is ${w} x ${h}, expected ${Math.ceil(width / s)} x ${Math.ceil(height / s)}`,
        );
      }
      if (array.chunks[0] !== tileSize || array.chunks[1] !== tileSize) {
        fail(`level ${k} has chunks of another size`);
      }
    }
    const size: ImageSize = { Width: width, Height: height };
    const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
    const minLevel = maxLevel - (levels.length - 1);
    let geometry: PyramidGeometry;
    try {
      geometry = new PyramidGeometry(size, tileSize, this.overlap, minLevel);
    } catch {
      fail('the coarsest level must be a single chunk');
    }

    const attrs = isObject(root.attrs.zoomdata) ? root.attrs.zoomdata : {};
    const version = attrs.version ?? 1;
    if (version !== SUPPORTED_VERSION) {
      fail(`unsupported version ${String(version)} (supported: ${SUPPORTED_VERSION})`);
    }
    const range = attrs.colorbarRange;
    let colorbarRange: ColorbarRange | null = null;
    if (range !== undefined) {
      if (!isObject(range) || !isFiniteNumber(range.minimum) || !isFiniteNumber(range.maximum)) {
        fail('invalid "colorbarRange"');
      }
      colorbarRange = { Minimum: range.minimum, Maximum: range.maximum };
    }

    // Pixel size of the full resolution, in the unit of the axes
    const axisUnit = typeof axes[1].unit === 'string' ? axes[1].unit : null;
    const transformations = (datasets[0] as Record<string, unknown>).coordinateTransformations;
    const scale = Array.isArray(transformations)
      ? transformations.find((t) => isObject(t) && t.type === 'scale')?.scale
      : undefined;
    let pixelsPerMeter: ImageSize | null = null;
    if (
      axisUnit &&
      axisUnit in OME_UNITS &&
      Array.isArray(scale) &&
      isFiniteNumber(scale[0]) &&
      isFiniteNumber(scale[1])
    ) {
      const meters = OME_UNITS[axisUnit];
      pixelsPerMeter = { Width: 1 / (scale[1] * meters), Height: 1 / (scale[0] * meters) };
    }

    const descriptor: PyramidDescriptor = {
      format: 'zarr',
      formatVersion: SUPPORTED_VERSION,
      minLevel,
      size,
      tileSize,
      overlap: this.overlap,
      encoding: encodings[0],
      colorbarRange,
      colorbarTitle: optionalString(attrs.colorbarTitle),
      pixelsPerMeter,
      unit:
        optionalString(attrs.unit) ??
        optionalString(levels[0].attrs.units) ??
        (axisUnit ? (UNIT_NAMES[axisUnit] ?? null) : null),
      detrend: optionalString(attrs.detrend),
      downsample: optionalString(attrs.downsample) ?? optionalString(multiscale.type),
    };
    return { descriptor, geometry, levels, encodings };
  }
}
