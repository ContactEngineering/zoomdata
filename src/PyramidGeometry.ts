import type { ImageSize } from './types';

/** Half-open rectangle [x0, x1) x [y0, y1) in pixels of some level */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Address of a tile in the pyramid */
export interface TileAddress {
  level: number;
  col: number;
  row: number;
}

/**
 * Geometry of a tile pyramid, described in terms of the image rather than of
 * how tiles are stored.
 *
 * Level `maxLevel = ceil(log2(max(width, height)))` holds the image at full
 * resolution; every level below halves the resolution, down to a single
 * pixel at level 0. Level `l` has stride `s = 2^(maxLevel - l)`: its pixel
 * `i` stands for image pixels `[i*s, (i+1)*s)`, truncated at the image
 * boundary, so it is `ceil(width / s)` pixels wide.
 *
 * Each level is cut into tiles of `tileSize` pixels. A tile's core is
 * `[col*tileSize, (col+1)*tileSize)` (truncated at the level boundary); the
 * stored tile extends the core by `overlap` pixels on every side where
 * there is data.
 */
export class PyramidGeometry {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly overlap: number;
  readonly maxLevel: number;

  constructor(size: ImageSize, tileSize: number, overlap: number) {
    if (!(size.Width > 0 && size.Height > 0)) {
      throw new Error(`Invalid image size ${size.Width} x ${size.Height}`);
    }
    if (!(Number.isInteger(tileSize) && tileSize > 0)) {
      throw new Error(`Invalid tile size ${tileSize}`);
    }
    if (!(Number.isInteger(overlap) && overlap >= 0)) {
      throw new Error(`Invalid overlap ${overlap}`);
    }
    this.width = size.Width;
    this.height = size.Height;
    this.tileSize = tileSize;
    this.overlap = overlap;
    this.maxLevel = Math.ceil(Math.log2(Math.max(this.width, this.height)));
  }

  /** Image pixels per pixel of the level */
  stride(level: number): number {
    return 2 ** (this.maxLevel - level);
  }

  /** Size of the level in its own pixels */
  levelSize(level: number): { width: number; height: number } {
    const s = this.stride(level);
    return { width: Math.ceil(this.width / s), height: Math.ceil(this.height / s) };
  }

  /** Number of tile columns and rows of the level */
  tileCount(level: number): { cols: number; rows: number } {
    const { width, height } = this.levelSize(level);
    return { cols: Math.ceil(width / this.tileSize), rows: Math.ceil(height / this.tileSize) };
  }

  /** Pixels of the level that the tile is responsible for */
  tileCore(level: number, col: number, row: number): PixelRect {
    const { width, height } = this.levelSize(level);
    const t = this.tileSize;
    return {
      x0: col * t,
      y0: row * t,
      x1: Math.min((col + 1) * t, width),
      y1: Math.min((row + 1) * t, height),
    };
  }

  /** Pixels of the level that the stored tile holds, including overlap */
  tileExtent(level: number, col: number, row: number): PixelRect {
    const core = this.tileCore(level, col, row);
    const { width, height } = this.levelSize(level);
    const o = this.overlap;
    return {
      x0: Math.max(core.x0 - o, 0),
      y0: Math.max(core.y0 - o, 0),
      x1: Math.min(core.x1 + o, width),
      y1: Math.min(core.y1 + o, height),
    };
  }

  /** Tile whose core contains the given pixel of the level */
  tileAt(level: number, x: number, y: number): TileAddress {
    return {
      level,
      col: Math.floor(x / this.tileSize),
      row: Math.floor(y / this.tileSize),
    };
  }

  /**
   * Tiles of the level whose cores intersect the rectangle, given in image
   * pixels (fractional values allowed). The rectangle is clipped to the
   * image.
   */
  tilesInRect(level: number, rect: PixelRect): TileAddress[] {
    const s = this.stride(level);
    const t = this.tileSize;
    const { cols, rows } = this.tileCount(level);
    const x0 = Math.max(0, rect.x0);
    const y0 = Math.max(0, rect.y0);
    const x1 = Math.min(this.width, rect.x1);
    const y1 = Math.min(this.height, rect.y1);
    if (x1 <= x0 || y1 <= y0) return [];
    const c0 = Math.floor(x0 / s / t);
    const r0 = Math.floor(y0 / s / t);
    const c1 = Math.min(cols - 1, Math.floor((x1 - 1e-9) / s / t));
    const r1 = Math.min(rows - 1, Math.floor((y1 - 1e-9) / s / t));
    const tiles: TileAddress[] = [];
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        tiles.push({ level, col, row });
      }
    }
    return tiles;
  }
}
