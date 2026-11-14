/**
 * Shared type definitions for the zoomdata library
 */
import type { TileLoaderOptions } from './TileLoader';
import type { TileSource } from './TileSource';

/** Size dimensions for images */
export interface ImageSize {
  Width: number;
  Height: number;
}

/**
 * Pyramid descriptor (dzdata.json), see docs/pyramid-format.md
 */
export interface DZIMetadata {
  Image: {
    Size: ImageSize;
    TileSize: number;
    Overlap: number;
    /** Tile format; only 'nc' is supported */
    Format?: string;
    /** Version of the NetCDF tile format (default 1) */
    FormatVersion?: number;
    ColorbarRange?: {
      Minimum: number;
      Maximum: number;
    };
    ColorbarTitle?: string;
    PixelsPerMeter?: ImageSize;
    /** Linear encoding of tile values (format version 2) */
    Encoding?: {
      ScaleFactor: number;
      AddOffset: number;
    };
    /** Unit of the height values */
    Unit?: string;
    /** Detrend mode applied to the data before writing */
    Detrend?: string;
    /** How coarse levels were computed: 'mean' or 'nearest' */
    Downsample?: string;
    Colormap?: string;
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
  /** Where the descriptor and tiles come from; takes precedence over rootUrl */
  source?: TileSource;
  /** Root URL where dzdata.json and dzdata_files/ are located */
  rootUrl?: string;
  /** Zoom level change per wheel notch (default: 0.25) */
  zoomLevelIncrement?: number;
  /** Install the default mouse, touch and keyboard controller (default: true) */
  controller?: boolean;
  /** Follow the canvas' CSS size and the device pixel ratio (default: true) */
  autoResize?: boolean;
  /** Color palette to use (array of 32-bit RGBA integers) */
  colorPalette?: number[];
  /** Value mapped to the first palette entry, in physical units (default: data minimum) */
  minValue?: number;
  /** Value mapped to the last palette entry, in physical units (default: data maximum) */
  maxValue?: number;
  /** Colour of undefined points, 32-bit ABGR like palette entries (default: transparent) */
  noDataColor?: number;
  /** Colour behind the image, 32-bit ABGR (default: light grey) */
  backgroundColor?: number;
  /** Concurrency and retries of tile requests */
  loader?: TileLoaderOptions;
  /** Memory budget for tiles in bytes, CPU and GPU (default: 256 MiB) */
  cacheBytes?: number;
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
