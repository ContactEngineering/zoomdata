import type { ValueEncoding } from './TileDecoder';
import type { ColorbarRange, DZIMetadata, ImageSize } from './types';

/** Tile format versions this reader understands */
export const SUPPORTED_FORMAT_VERSIONS = [1, 2] as const;
export type FormatVersion = (typeof SUPPORTED_FORMAT_VERSIONS)[number];

/** Validated pyramid descriptor, see docs/pyramid-format.md */
export interface PyramidDescriptor {
  formatVersion: FormatVersion;
  size: ImageSize;
  tileSize: number;
  overlap: number;
  /** Turns stored tile values v into physical values: offset + scale * v */
  encoding: ValueEncoding;
  /** Range of the defined physical values */
  colorbarRange: ColorbarRange | null;
  colorbarTitle: string | null;
  pixelsPerMeter: ImageSize | null;
  unit: string | null;
  detrend: string | null;
  downsample: string | null;
}

function fail(message: string): never {
  throw new Error(`Invalid dzdata.json: ${message}`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseDescriptor(data: DZIMetadata): PyramidDescriptor {
  const image = data?.Image;
  if (!image) fail('missing "Image" field');
  if (!image.Size || !isFiniteNumber(image.Size.Width) || !isFiniteNumber(image.Size.Height)) {
    fail('missing or invalid "Image.Size"');
  }
  if (!isFiniteNumber(image.TileSize)) fail('missing or invalid "Image.TileSize"');
  const overlap = image.Overlap ?? 0;
  if (!Number.isInteger(overlap) || overlap < 0) fail('invalid "Image.Overlap"');
  if (image.Format !== undefined && image.Format !== 'nc') {
    fail(`unsupported tile format "${image.Format}"`);
  }

  const formatVersion = image.FormatVersion ?? 1;
  if (!(SUPPORTED_FORMAT_VERSIONS as readonly number[]).includes(formatVersion)) {
    fail(
      `unsupported format version ${formatVersion} ` +
        `(supported: ${SUPPORTED_FORMAT_VERSIONS.join(', ')})`,
    );
  }

  const range = image.ColorbarRange ?? null;
  if (range && !(isFiniteNumber(range.Minimum) && isFiniteNumber(range.Maximum))) {
    fail('invalid "Image.ColorbarRange"');
  }

  let encoding: ValueEncoding;
  if (formatVersion === 2) {
    const e = image.Encoding;
    if (!e || !isFiniteNumber(e.ScaleFactor) || !isFiniteNumber(e.AddOffset)) {
      fail('format version 2 requires "Image.Encoding"');
    }
    encoding = { scaleFactor: e.ScaleFactor, addOffset: e.AddOffset };
  } else if (range) {
    // Version 1 tiles hold (h - min) / (max - min); a flat map has scale 1
    const width = range.Maximum - range.Minimum;
    encoding = { scaleFactor: width > 0 ? width : 1, addOffset: range.Minimum };
  } else {
    encoding = { scaleFactor: 1, addOffset: 0 };
  }

  return {
    formatVersion: formatVersion as FormatVersion,
    size: image.Size,
    tileSize: image.TileSize,
    overlap,
    encoding,
    colorbarRange: range,
    colorbarTitle: image.ColorbarTitle ?? null,
    pixelsPerMeter: image.PixelsPerMeter ?? null,
    unit: image.Unit ?? null,
    detrend: image.Detrend ?? null,
    downsample: image.Downsample ?? null,
  };
}
