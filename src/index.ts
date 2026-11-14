/**
 * zoomdata - JavaScript library for zoomable visualization of two-dimensional data maps
 *
 * @packageDocumentation
 */

// Main entry point
export { ZoomData } from './ZoomData';

// Engine and default input handling
export { ZoomEngine } from './ZoomEngine';
export type { View, ZoomEngineEvents, ZoomEngineOptions } from './ZoomEngine';
export { DefaultController } from './DefaultController';
export { CrossSections, sampleProfile } from './CrossSections';
export type { CrossSectionsOptions, Profile } from './CrossSections';
export { LineScanRenderer } from './LineScanRenderer';
export type { LineScanData } from './LineScanRenderer';
export { Scalebar } from './Scalebar';
export type { DefaultControllerOptions } from './DefaultController';

// Supporting classes (for advanced usage)
export { Colorbar } from './Colorbar';
export type { ColorbarOptions, ColorbarOrientation } from './Colorbar';
export { Tile } from './Tile';
export { TileCache } from './TileCache';
export type { TileCacheOptions } from './TileCache';
export { TileLoader, HttpError } from './TileLoader';
export type { TileLoaderOptions, TileRequest } from './TileLoader';
export { TiledImage } from './TiledImage';
export { ZoomConfiguration } from './ZoomConfiguration';
export { PyramidGeometry } from './PyramidGeometry';
export type { PixelRect, TileAddress } from './PyramidGeometry';
export { StaticTileSource } from './TileSource';
export { sampleAt } from './sampling';
export type { Sample, TileLookup } from './sampling';
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
