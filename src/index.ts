/**
 * zoomdata - JavaScript library for zoomable visualization of two-dimensional data maps
 *
 * @packageDocumentation
 */

// Main entry point
export { ZoomData } from './ZoomData';

// Supporting classes (for advanced usage)
export { Colorbar } from './Colorbar';
export type { ColorbarOptions, ColorbarOrientation } from './Colorbar';
export { Tile } from './Tile';
export { TileCache } from './TileCache';
export { TiledImage } from './TiledImage';
export { ZoomConfiguration } from './ZoomConfiguration';
export { PyramidGeometry } from './PyramidGeometry';
export type { PixelRect, TileAddress } from './PyramidGeometry';
export { StaticTileSource } from './TileSource';
export type { TileSource } from './TileSource';
export { WebGLRenderer, supportsWebGL2 } from './WebGLRenderer';
export type { ViewTransform } from './WebGLRenderer';

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
