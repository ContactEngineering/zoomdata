import { HttpError } from './http.js';
import { parseDescriptor, type PyramidDescriptor } from './PyramidDescriptor.js';
import type { PyramidReader } from './PyramidReader.js';
import { decodeTile, type DecodedTile } from './TileDecoder.js';
import type { TileSource } from './TileSource.js';

/**
 * Reader for pyramids of NetCDF tiles (docs/pyramid-format.md): the
 * descriptor and one file per tile, located by a TileSource.
 */
export class NetCDFReader implements PyramidReader {
  readonly source: TileSource;
  /** Present if the source can replace expired URLs */
  readonly invalidate?: (level: number, col: number, row: number) => void;

  constructor(source: TileSource) {
    this.source = source;
    if (source.invalidate) {
      this.invalidate = (level, col, row) => source.invalidate!(level, col, row);
    }
  }

  async descriptor(): Promise<PyramidDescriptor> {
    return parseDescriptor(await this.source.descriptor());
  }

  async readTile(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<DecodedTile> {
    const url = await this.source.tileUrl(level, col, row);
    if (url === null) throw new Error('Tile not available');
    signal?.throwIfAborted();
    const response = await fetch(url, { signal });
    if (!response.ok) throw new HttpError(response.status, response.statusText);
    return decodeTile(await response.arrayBuffer());
  }
}
