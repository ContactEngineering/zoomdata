import type { PyramidDescriptor } from './PyramidDescriptor.js';
import type { DecodedTile } from './TileDecoder.js';

/**
 * Reads a pyramid: its descriptor and the values of its tiles. The engine
 * addresses tiles by level, column and row (see PyramidGeometry); a reader
 * knows where and how they are stored.
 *
 * `readTile` makes a single attempt. It throws an HttpError for a failed
 * request, which the TileLoader retries if the error is transient. On HTTP
 * 403 the loader calls `invalidate`, if present, and tries once more, so
 * that a reader can replace an expired (e.g. presigned) URL.
 */
export interface PyramidReader {
  /** The validated pyramid descriptor */
  descriptor(): Promise<PyramidDescriptor>;
  /**
   * Values of a tile: its core extended by the descriptor's overlap, as
   * given by `PyramidGeometry.tileExtent`
   */
  readTile(level: number, col: number, row: number, signal?: AbortSignal): Promise<DecodedTile>;
  /** Forget the URL used for the tile, e.g. after HTTP 403 */
  invalidate?(level: number, col: number, row: number): void;
}

export function isPyramidReader(source: unknown): source is PyramidReader {
  return typeof source === 'object' && source !== null && 'readTile' in source;
}
