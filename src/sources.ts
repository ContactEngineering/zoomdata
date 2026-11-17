import { NetCDFReader } from './NetCDFReader.js';
import { isPyramidReader, type PyramidReader } from './PyramidReader.js';
import { StaticTileSource, type TileSource } from './TileSource.js';
import { ZarrSource } from './ZarrSource.js';

/** Whether a URL names a zipped OME-Zarr pyramid, by its suffix `.ozx` */
function isZarrUrl(url: string): boolean {
  return new URL(url, 'http://localhost/').pathname.endsWith('.ozx');
}

/**
 * Reader for a pyramid given as a reader, a TileSource of NetCDF tiles, or
 * a URL: of a zipped OME-Zarr file (`.ozx`), or else of the root directory
 * of a static NetCDF pyramid
 */
export function toPyramidReader(source: PyramidReader | TileSource | string): PyramidReader {
  if (typeof source === 'string') {
    return isZarrUrl(source)
      ? new ZarrSource(source)
      : new NetCDFReader(new StaticTileSource(source));
  }
  return isPyramidReader(source) ? source : new NetCDFReader(source);
}
