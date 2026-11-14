import type { DZIMetadata } from './types';

/**
 * Where a pyramid's descriptor and tiles come from. The renderer addresses
 * tiles only by level, column and row; a source turns that into a URL.
 *
 * Sources may hand out URLs that differ per tile and expire (e.g. presigned
 * URLs); `invalidate` tells the source that a URL it returned was rejected,
 * so that the next `tileUrl` call for that tile returns a fresh one.
 */
export interface TileSource {
  /** The pyramid descriptor (contents of dzdata.json) */
  descriptor(): Promise<DZIMetadata>;
  /** URL of a tile, or null if the tile does not exist */
  tileUrl(level: number, col: number, row: number): Promise<string | null>;
  /** Forget a cached URL for the tile, e.g. after HTTP 403 */
  invalidate?(level: number, col: number, row: number): void;
}

/**
 * Tile source for a static directory: `<rootUrl>dzdata.json` and
 * `<rootUrl>dzdata_files/<level>/<col>_<row>.nc`.
 */
export class StaticTileSource implements TileSource {
  readonly rootUrl: string;

  constructor(rootUrl: string) {
    this.rootUrl = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`;
  }

  get descriptorUrl(): string {
    return `${this.rootUrl}dzdata.json`;
  }

  async descriptor(): Promise<DZIMetadata> {
    const response = await fetch(this.descriptorUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async tileUrl(level: number, col: number, row: number): Promise<string | null> {
    return `${this.rootUrl}dzdata_files/${level}/${col}_${row}.nc`;
  }
}

/** Accept a source or, for convenience, the root URL of a static pyramid */
export function toTileSource(source: TileSource | string): TileSource {
  return typeof source === 'string' ? new StaticTileSource(source) : source;
}
