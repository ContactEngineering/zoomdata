/**
 * zoomdata - JavaScript library for zoomable visualization of two-dimensional data maps
 *
 * @packageDocumentation
 */

// Main entry point
export { ZoomData } from './ZoomData.js';

// Engine and default input handling
export { ZoomEngine } from './ZoomEngine.js';
export type { Pick, View, ZoomEngineEvents, ZoomEngineOptions } from './ZoomEngine.js';
export { MAX_TILT } from './camera.js';
export type { ReliefOptions } from './relief.js';
export { DefaultController } from './DefaultController.js';
export { CrossSections, sampleProfile } from './CrossSections.js';
export type { CrossSectionsOptions, Profile } from './CrossSections.js';
export { LineScanRenderer } from './LineScanRenderer.js';
export type { LineScanData } from './LineScanRenderer.js';
export { Scalebar } from './Scalebar.js';
export type { DefaultControllerOptions } from './DefaultController.js';

// Supporting classes (for advanced usage)
export { Colorbar } from './Colorbar.js';
export type { ColorbarOptions } from './Colorbar.js';
export { Tile } from './Tile.js';
export { TileCache } from './TileCache.js';
export type { TileCacheOptions } from './TileCache.js';
export { TileLoader } from './TileLoader.js';
export { HttpError } from './http.js';
export type { TileLoaderOptions, TileRequest } from './TileLoader.js';
export { TiledImage } from './TiledImage.js';
export { ZoomConfiguration } from './ZoomConfiguration.js';
export { PyramidGeometry } from './PyramidGeometry.js';
export type { PixelRect, TileAddress } from './PyramidGeometry.js';
export { StaticTileSource } from './TileSource.js';
export { NetCDFReader } from './NetCDFReader.js';
export { ZarrSource } from './ZarrSource.js';
export type { UrlSource, ZarrSourceOptions } from './ZarrSource.js';
export { toPyramidReader } from './sources.js';
export type { PyramidReader } from './PyramidReader.js';
export type { PyramidDescriptor } from './PyramidDescriptor.js';
export type { DecodedTile, ValueEncoding } from './TileDecoder.js';
export { sampleAt } from './sampling.js';
export type { Sample, TileLookup } from './sampling.js';
export type { TileSource } from './TileSource.js';
export { WebGLRenderer, supportsWebGL2 } from './WebGLRenderer.js';
export type { ViewTransform } from './WebGLRenderer.js';

// Types
export type { DZIMetadata, ImageSize, RenderCallback, ZoomDataOptions } from './types.js';

export { TileState } from './types.js';

// Color palettes
export { Palettes, inferno, viridis, magma, plasma, grayscale } from './palettes.js';
