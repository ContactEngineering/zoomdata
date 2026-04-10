/**
 * Colorbar renders a labeled color scale into an HTML canvas element.
 * Supports vertical and horizontal orientations with automatic tick generation.
 */

export type ColorbarOrientation = 'vertical' | 'horizontal';

export interface ColorbarOptions {
  canvas: HTMLCanvasElement;
  /** Array of 32-bit RGBA colors in little-endian format (0xAABBGGRR) */
  palette: number[];
  minValue: number;
  maxValue: number;
  title?: string;
  numTicks?: number;
  fontSize?: number;
  fontFamily?: string;
  tickColor?: string;
  tickLength?: number;
  tickLabelGap?: number;  
  barThickness?: number;  /** Bar thickness in px (default: 24) */
}

export class Colorbar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private palette: number[];
  private minValue: number;
  private maxValue: number;
  private title: string;
  private numTicks: number;
  private fontSize: number;
  private fontFamily: string;
  private tickColor: string;
  private tickLength: number;
  private tickLabelGap: number;
  private barThickness: number;
  

  constructor(options: ColorbarOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Colorbar: failed to get 2D context');
    this.ctx = ctx;

    this.palette = options.palette;
    this.minValue = options.minValue;
    this.maxValue = options.maxValue;
    this.title = options.title ?? '';
    this.numTicks = options.numTicks ?? 6;
    this.fontSize = options.fontSize ?? 12;
    this.fontFamily = options.fontFamily ?? "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    this.tickColor = options.tickColor ?? '#333';
    this.tickLength = options.tickLength ?? 6;
    this.tickLabelGap = options.tickLabelGap ?? 4;
    this.barThickness = options.barThickness ?? 24;
  }


  /**
   * Update the palette and re-render
   */
  setPalette(palette: number[]): void {
    this.palette = palette;
    this.render();
  }

  /**
   * Update the value range and re-render
   */
  setRange(minValue: number, maxValue: number): void {
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.render();
  }

  /**
   * Render the colorbar onto the canvas.
   * Call this after construction and after any option changes.
   */
  render(): void {
    this.renderVertical();
  }

  

  /**
   * Convert a palette entry (little-endian 0xAABBGGRR) to a CSS rgb() string
   */
  private paletteEntryToCss(color: number): string {
    const r = color & 0xff;
    const g = (color >> 8) & 0xff;
    const b = (color >> 16) & 0xff;
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Generate nicely rounded tick values spanning [minValue, maxValue].
   * Uses the same "nice number" approach as the Scalebar.
   */
  private generateTicks(): number[] {
    const range = this.maxValue - this.minValue;
    if (range === 0) return [this.minValue];

    // Raw step
    const rawStep = range / (this.numTicks - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
    const normalized = rawStep / magnitude;

    let niceStep: number;
    if (normalized < 1.5) niceStep = 1;
    else if (normalized < 3.5) niceStep = 2;
    else if (normalized < 7.5) niceStep = 5;
    else niceStep = 10;
    niceStep *= magnitude;

    // First tick at or above minValue, snapped to grid
    const firstTick = Math.ceil(this.minValue / niceStep) * niceStep;

    const ticks: number[] = [];
    for (let t = firstTick; t <= this.maxValue + niceStep * 1e-9; t += niceStep) {
      const rounded = Math.round(t / niceStep) * niceStep; // avoid floating-point drift
      if (rounded >= this.minValue - niceStep * 1e-9 && rounded <= this.maxValue + niceStep * 1e-9) {
        ticks.push(rounded);
      }
    }

    return ticks;
  }

  /**
   * Format a tick value for display. Avoids unnecessary decimal places.
   */
  private formatTick(value: number): string {
    const range = Math.abs(this.maxValue - this.minValue);
    // Decide how many decimals we need
    const magnitude = range > 0 ? Math.floor(Math.log10(range)) : 0;
    const decimals = Math.max(0, -magnitude + 1);
    return value.toFixed(decimals);
  }

  // Rendering vertically 

  private renderVertical(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    const font = `${this.fontSize}px ${this.fontFamily}`;
    ctx.font = font;

    // Measure the widest tick label so we can reserve space
    const ticks = this.generateTicks();
    let maxLabelWidth = 0;
    for (const t of ticks) {
      const w = ctx.measureText(this.formatTick(t)).width;
      if (w > maxLabelWidth) maxLabelWidth = w;
    }

    // Layout (left→right):  [title rotated] [bar] [tick] [gap] [label]
    const titleAreaWidth = this.title ? this.fontSize + 6 : 0;
    const barLeft = titleAreaWidth + 2;
    const barRight = barLeft + this.barThickness;
    const tickEnd = barRight + this.tickLength;
    const labelLeft = tickEnd + this.tickLabelGap;

    // Vertical margins so ticks at top/bottom have room
    const marginTop = Math.ceil(this.fontSize / 2) + 2;
    const marginBottom = Math.ceil(this.fontSize / 2) + 2;
    const barTop = marginTop;
    const barBottom = H - marginBottom;
    const barHeight = barBottom - barTop;

    // Draw gradient bar using an off-screen canvas (palette linear-gradient)
    this.drawVerticalBar(barLeft, barTop, this.barThickness, barHeight);

    // Draw thin border around bar
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.strokeRect(barLeft + 0.5, barTop + 0.5, this.barThickness - 1, barHeight - 1);

    // Draw ticks + labels
    ctx.fillStyle = this.tickColor;
    ctx.strokeStyle = this.tickColor;
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const t of ticks) {
      // Map value to vertical pixel: maxValue at top, minValue at bottom
      const frac = (t - this.minValue) / (this.maxValue - this.minValue);
      const y = barBottom - frac * barHeight; // top = max, bottom = min

      // Tick line
      ctx.beginPath();
      ctx.moveTo(barRight, y);
      ctx.lineTo(tickEnd, y);
      ctx.stroke();

      // Label
      ctx.fillText(this.formatTick(t), labelLeft, y);
    }

    // Draw rotated title on the left
    if (this.title) {
      ctx.save();
      ctx.font = `bold ${this.fontSize}px ${this.fontFamily}`;
      ctx.fillStyle = this.tickColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const titleX = Math.floor(this.fontSize / 2) + 1;
      const titleY = barTop + barHeight / 2;
      ctx.translate(titleX, titleY);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(this.title, 0, 0);
      ctx.restore();
    }
  }

  /**
   * Fill [x, y, w, h] with the palette gradient (high value at top)
   */
  private drawVerticalBar(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const n = this.palette.length;

    // Draw pixel-by-pixel rows mapped from palette entries
    // We sample the palette at each pixel row for accuracy
    for (let row = 0; row < h; row++) {
      // row=0 → top → maxValue; row=h-1 → bottom → minValue
      const frac = 1 - row / (h - 1);
      const idx = Math.min(Math.floor(frac * (n - 1)), n - 1);
      ctx.fillStyle = this.paletteEntryToCss(this.palette[idx]);
      ctx.fillRect(x, y + row, w, 1);
    }
  }
}
