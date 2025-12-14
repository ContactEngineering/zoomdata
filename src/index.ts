/**
 * zoomdata - JavaScript library for zoomable visualization of two-dimensional data maps
 *
 * @packageDocumentation
 */

// Main entry point
export { ZoomData } from './ZoomData';

// Supporting classes (for advanced usage)
export { ColorMapper } from './ColorMapper';
export { Tile } from './Tile';
export { TileCache } from './TileCache';
export { TiledImage } from './TiledImage';
export { ZoomConfiguration } from './ZoomConfiguration';

// Types
export type {
  DZIMetadata,
  ImageSize,
  RenderCallback,
  TileCoordinate,
  ViewportBounds,
  ZoomDataOptions,
} from './types';

export { TileState } from './types';

// Color palettes
export { Palettes, inferno, viridis, magma, plasma, grayscale } from './palettes';
