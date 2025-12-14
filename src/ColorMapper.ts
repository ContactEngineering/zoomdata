/**
 * ColorMapper converts numeric data arrays into colored canvas images
 * using a specified color palette.
 */
export class ColorMapper {
  private readonly colorPalette: number[];
  private readonly minValue: number;
  private readonly maxValue: number;
  private readonly paletteLength: number;

  /**
   * Create a new ColorMapper
   * @param colorPalette - Array of 32-bit RGBA color values
   * @param minValue - Minimum data value (maps to first color)
   * @param maxValue - Maximum data value (maps to last color)
   */
  constructor(colorPalette: number[], minValue: number, maxValue: number) {
    if (colorPalette.length === 0) {
      throw new Error('ColorMapper: colorPalette must not be empty');
    }
    if (minValue >= maxValue) {
      throw new Error('ColorMapper: minValue must be less than maxValue');
    }

    this.colorPalette = colorPalette;
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.paletteLength = colorPalette.length;
  }

  /**
   * Map a single value to a color index
   * @param value - The data value to map
   * @returns The color from the palette
   */
  private mapValueToColor(value: number): number {
    // Normalize value to [0, 1] range
    const normalized = (value - this.minValue) / (this.maxValue - this.minValue);

    // Clamp to valid range to handle out-of-bounds values
    const clamped = Math.max(0, Math.min(1, normalized));

    // Map to palette index
    const colorIndex = Math.floor(clamped * (this.paletteLength - 1));

    return this.colorPalette[colorIndex];
  }

  /**
   * Render data to an OffscreenCanvas with color mapping applied
   * @param data - Array of numeric values (row-major order)
   * @param width - Width of the output image
   * @param height - Height of the output image
   * @returns OffscreenCanvas with the rendered image
   */
  render(data: ArrayLike<number>, width: number, height: number): OffscreenCanvas {
    if (data.length !== width * height) {
      throw new Error(
        `ColorMapper.render: data length (${data.length}) does not match dimensions (${width}x${height}=${width * height})`
      );
    }

    // Create image data buffer
    const imageData = new ImageData(width, height);
    const imageDataView = new DataView(imageData.data.buffer);

    // Map each pixel
    for (let i = 0; i < data.length; i++) {
      const color = this.mapValueToColor(data[i]);
      imageDataView.setUint32(4 * i, color, true); // true = little-endian
    }

    // Render to offscreen canvas
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('ColorMapper.render: failed to get 2D context');
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas;
  }

  /**
   * Get the current min value
   */
  getMinValue(): number {
    return this.minValue;
  }

  /**
   * Get the current max value
   */
  getMaxValue(): number {
    return this.maxValue;
  }

  /**
   * Create a new ColorMapper with updated value range
   * @param minValue - New minimum value
   * @param maxValue - New maximum value
   * @returns New ColorMapper instance
   */
  withRange(minValue: number, maxValue: number): ColorMapper {
    return new ColorMapper(this.colorPalette, minValue, maxValue);
  }
}
