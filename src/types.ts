/**
 * Shared type definitions for the zoomdata library
 */

/** Size dimensions for images */
export interface ImageSize {
  Width: number;
  Height: number;
}

/** Deep Zoom Image metadata structure (from dzdata.json) */
export interface DZIMetadata {
  Image: {
    Size: ImageSize;
    TileSize: number;
    Overlap: number;
    ColorbarRange?: {
      Minimum: number;
      Maximum: number;
    };
    ColorbarTitle?: string;
    PixelsPerMeter?: ImageSize
  };
}

/** Coordinates for a tile in the zoom pyramid */
export interface TileCoordinate {
  zoomLevel: number;
  row: number;
  column: number;
}

/** Options for initializing ZoomData */
export interface ZoomDataOptions {
  /** Root URL where dzdata.json and dzdata_files/ are located */
  rootUrl: string;
  /** Zoom level change per scroll increment (default: 0.1) */
  zoomLevelIncrement?: number;
  /** Color palette to use (array of 32-bit RGBA integers) */
  colorPalette?: number[];
  /** Minimum data value for color mapping */
  minValue?: number;
  /** Maximum data value for color mapping */
  maxValue?: number;
  /** Enable debug rendering (tile borders) */
  debug?: boolean;
}

/** State of a tile in the cache */
export enum TileState {
  /** Tile data not yet requested */
  Pending = 'pending',
  /** Tile data is being fetched */
  Loading = 'loading',
  /** Tile data loaded and ready to render */
  Ready = 'ready',
  /** Tile fetch failed */
  Error = 'error',
}

/** Viewport bounds in data coordinates */
export interface ViewportBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Callback for render completion */
export type RenderCallback = () => void;



export interface ColorbarRange {
  Minimum: number;
  Maximum: number;
}