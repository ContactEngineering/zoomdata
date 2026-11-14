import type { PyramidGeometry } from './PyramidGeometry.js';
import type { Tile } from './Tile.js';

/** A value read from the pyramid */
export interface Sample {
  /** Value in physical units; NaN where the data is undefined */
  value: number;
  /** Level the value came from */
  level: number;
  /** Image pixels per pixel of that level */
  stride: number;
  /** Pixel of that level the value came from */
  levelX: number;
  levelY: number;
  /**
   * Image pixels the value stands for: [imageX0, imageX0 + stride) x
   * [imageY0, imageY0 + stride), truncated at the image boundary
   */
  imageX0: number;
  imageY0: number;
}

/** Returns a tile if it is in memory and ready, without fetching it */
export type TileLookup = (level: number, col: number, row: number) => Tile | undefined;

/**
 * Sample the value at an image position from the finest level in memory.
 *
 * Image pixel (x, y) covers [x, x+1) x [y, y+1); at level l with stride s it
 * belongs to level pixel (floor(x / s), floor(y / s)), which is read from the
 * tile whose core contains it, at its offset from the tile's overlapped
 * extent.
 *
 * @param maxLevel - Finest level to consider (default: the finest level)
 * @returns The sample, or null outside the image or if no tile covering the
 *   position is in memory
 */
export function sampleAt(
  geometry: PyramidGeometry,
  lookup: TileLookup,
  imageX: number,
  imageY: number,
  maxLevel: number = geometry.maxLevel,
): Sample | null {
  if (!(imageX >= 0 && imageY >= 0 && imageX < geometry.width && imageY < geometry.height)) {
    return null;
  }
  for (let level = Math.min(maxLevel, geometry.maxLevel); level >= 0; level--) {
    const stride = geometry.stride(level);
    const levelX = Math.floor(imageX / stride);
    const levelY = Math.floor(imageY / stride);
    const { col, row } = geometry.tileAt(level, levelX, levelY);
    const tile = lookup(level, col, row);
    if (!tile || !tile.isReady()) continue;
    const extent = geometry.tileExtent(level, col, row);
    return {
      value: tile.valueAt(levelX - extent.x0, levelY - extent.y0),
      level,
      stride,
      levelX,
      levelY,
      imageX0: levelX * stride,
      imageY0: levelY * stride,
    };
  }
  return null;
}
