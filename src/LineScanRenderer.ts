/**
 * LineScanRenderer draws a line scan chart (topographic profile) on a 2D canvas.
 * Used to display horizontal and vertical cross sections through the data at the crosshair position.
 */

export interface LineScanData {
  values: Float32Array;
  positions: Float32Array;
  crosshairPos: number;
  posMin: number;
  posMax: number;
  posAxisLabel: string;
  valueAxisLabel: string;
  orientation: 'horizontal' | 'vertical';
  valueMin: number;
  valueMax: number;
}

export class LineScanRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // ********** Layout margins ****************
  private PAD_LEFT = 58;
  private PAD_RIGHT = 12;
  private PAD_TOP = 10;
  private PAD_BOTTOM = 38;

  // ***********Style ******************
  private BG_COLOR = '#0f1117';
  private TRACE_COLOR = '#5ee7c4';
  private TRACE_GLOW_COLOR = 'rgba(94, 231, 196, 0.30)';
  private CROSSHAIR_COLOR = 'rgba(255, 80, 80, 0.85)';
  private EMPTY_TEXT_COLOR = '#2a3545';
  private GRID_COLOR = '#1a2030';
  private AXIS_COLOR = '#3a4555';
  private TICK_COLOR = '#5a6880';
  private LABEL_COLOR = '#7a8898';

  constructor(canvas: HTMLCanvasElement) {
    // trying to get the 2d context for the canvas element so that we can draw
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('LineScanRenderer: failed to get 2D context');
    this.ctx = ctx;
  }

  /**
   * Draw an empty placeholder (shown before a crosshair is placed).
   */
  drawEmpty(): void {
    const { canvas, ctx } = this;
    ctx.fillStyle = this.BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = this.EMPTY_TEXT_COLOR;
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('double-click on image to place crosshair', canvas.width / 2, canvas.height / 2);
  }

  /**
   * Draw the full line scan chart for the given data.
   */
  draw(data: LineScanData): void {
    const { canvas, ctx } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Background
    ctx.fillStyle = this.BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    if (data.values.length === 0) {
      this.drawEmpty();
      return;
    }

    // Plot area bounds
    const plotX = this.PAD_LEFT; // left edge of a plot area
    const plotY = this.PAD_TOP; // top edge of a plot area together plot x and plot y defines the top left corner of the plot area
    const plotW = W - this.PAD_LEFT - this.PAD_RIGHT; // width of the plot area
    const plotH = H - this.PAD_TOP - this.PAD_BOTTOM; // height of the plot area
    if (plotW <= 0 || plotH <= 0) return;

    // *** Compute value ranges *****************

    // let vMin = Infinity, vMax = -Infinity;
    // for (let i = 0; i < data.values.length; i++) {
    //   const v = data.values[i];
    //   if (isFinite(v)) {
    //     if (v < vMin) vMin = v;
    //     if (v > vMax) vMax = v;
    //   }
    // }
    // if (!isFinite(vMin)) { this.drawEmpty(); return; }

    // Pad the value range by a small fraction so the trace never touches and gets cut off
    // against the top/bottom frame.
    const VALUE_PAD_FRAC = 0.03;
    const rawLo = data.valueMin;
    const rawHi = data.valueMax;
    const valuePad = (rawHi - rawLo) * VALUE_PAD_FRAC || 0.5;
    const vLo = rawLo - valuePad;
    const vHi = rawHi + valuePad;

    // const vLo = data.valueMin;
    // const vHi = data.valueMax;

    const posMin = data.posMin;
    const posMax = data.posMax;
    const posRange = posMax - posMin || 1;

    const isVertical = data.orientation === 'vertical';

    // ********Coordinate mappers**********
    const hPosToX = (p: number) => plotX + ((p - posMin) / posRange) * plotW; // gives the exact pixel to draw position p on the hscancanvas
    const hValToY = (v: number) => plotY + plotH - ((v - vLo) / (vHi - vLo)) * plotH; // gives you the exact pixel to draw the height

    // Vertical scan: pos to Y (pos increases downward, matching image), value to X
    const vPosToY = (p: number) => plotY + ((p - posMin) / posRange) * plotH;
    const vValToX = (v: number) => plotX + ((v - vLo) / (vHi - vLo)) * plotW;

    // Grid
    this.drawGrid(
      plotX,
      plotY,
      plotW,
      plotH,
      vLo,
      vHi,
      posMin,
      posMax,
      isVertical,
      hPosToX,
      hValToY,
      vPosToY,
      vValToX,
    );

    // ****** Clip to plot area ********
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    // ****** Crosshair position marker ********
    ctx.strokeStyle = this.CROSSHAIR_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (!isVertical) {
      const cx = hPosToX(data.crosshairPos);
      ctx.moveTo(cx, plotY);
      ctx.lineTo(cx, plotY + plotH);
    } else {
      const cy = vPosToY(data.crosshairPos);
      ctx.moveTo(plotX, cy);
      ctx.lineTo(plotX + plotW, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // ****** Tracing the line  ********
    for (let pass = 0; pass < 2; pass++) {
      // two passes are made here to give the glow effect to the line
      ctx.strokeStyle = pass === 0 ? this.TRACE_GLOW_COLOR : this.TRACE_COLOR;
      ctx.lineWidth = pass === 0 ? 4 : 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      let firstPoint = true;
      const n = data.values.length;
      for (let i = 0; i < n; i++) {
        const v = data.values[i];
        if (!isFinite(v)) continue;
        const p = data.positions[i];
        const px = isVertical ? vValToX(v) : hPosToX(p);
        const py = isVertical ? vPosToY(p) : hValToY(v);
        if (firstPoint) {
          ctx.moveTo(px, py);
          firstPoint = false;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }

    ctx.restore(); // end clippping

    //  Axes, ticks, labels
    this.drawAxes(
      plotX,
      plotY,
      plotW,
      plotH,
      vLo,
      vHi,
      posMin,
      posMax,
      isVertical,
      data.posAxisLabel,
      data.valueAxisLabel,
      hPosToX,
      hValToY,
      vPosToY,
      vValToX,
    );
  }

  private drawGrid(
    plotX: number,
    plotY: number,
    plotW: number,
    plotH: number,
    vLo: number,
    vHi: number,
    posMin: number,
    posMax: number,
    isVertical: boolean,
    hPosToX: (p: number) => number,
    hValToY: (v: number) => number,
    vPosToY: (p: number) => number,
    vValToX: (v: number) => number,
  ): void {
    const ctx = this.ctx;
    ctx.strokeStyle = this.GRID_COLOR;
    ctx.lineWidth = 1;

    // Value grid lines
    for (const t of this.niceTicks(vLo, vHi, 4)) {
      if (t < vLo || t > vHi) continue;
      ctx.beginPath();
      if (!isVertical) {
        const y = hValToY(t);
        ctx.moveTo(plotX, y);
        ctx.lineTo(plotX + plotW, y);
      } else {
        const x = vValToX(t);
        ctx.moveTo(x, plotY);
        ctx.lineTo(x, plotY + plotH);
      }
      ctx.stroke();
    }

    // Position grid lines
    for (const t of this.niceTicks(posMin, posMax, isVertical ? 4 : 5)) {
      if (t < posMin || t > posMax) continue;
      ctx.beginPath();
      if (!isVertical) {
        const x = hPosToX(t);
        ctx.moveTo(x, plotY);
        ctx.lineTo(x, plotY + plotH);
      } else {
        const y = vPosToY(t);
        ctx.moveTo(plotX, y);
        ctx.lineTo(plotX + plotW, y);
      }
      ctx.stroke();
    }
  }

  private drawAxes(
    plotX: number,
    plotY: number,
    plotW: number,
    plotH: number,
    vLo: number,
    vHi: number,
    posMin: number,
    posMax: number,
    isVertical: boolean,
    posAxisLabel: string,
    valueAxisLabel: string,
    hPosToX: (p: number) => number,
    hValToY: (v: number) => number,
    vPosToY: (p: number) => number,
    vValToX: (v: number) => number,
  ): void {
    const ctx = this.ctx;

    // Axis border lines (left + bottom)
    ctx.strokeStyle = this.AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, plotY);
    ctx.lineTo(plotX, plotY + plotH);
    ctx.lineTo(plotX + plotW, plotY + plotH);
    ctx.stroke();

    ctx.font = '10px monospace';

    //  Value axis ticks & labels
    for (const t of this.niceTicks(vLo, vHi, 4)) {
      if (t < vLo || t > vHi) continue;
      const label = this.formatTick(t);
      if (!isVertical) {
        // Value on Y axis (left side)
        const y = hValToY(t);
        ctx.fillStyle = this.TICK_COLOR;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, plotX - 5, y);
        ctx.strokeStyle = this.AXIS_COLOR;
        ctx.beginPath();
        ctx.moveTo(plotX - 3, y);
        ctx.lineTo(plotX, y);
        ctx.stroke();
      } else {
        // Value on X axis (bottom)
        const x = vValToX(t);
        ctx.fillStyle = this.TICK_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, plotY + plotH + 4);
        ctx.strokeStyle = this.AXIS_COLOR;
        ctx.beginPath();
        ctx.moveTo(x, plotY + plotH);
        ctx.lineTo(x, plotY + plotH + 3);
        ctx.stroke();
      }
    }

    //  Position axis ticks & labels
    for (const t of this.niceTicks(posMin, posMax, isVertical ? 4 : 5)) {
      if (t < posMin || t > posMax) continue;
      const label = this.formatTick(t);
      if (!isVertical) {
        // Position on X axis (bottom)
        const x = hPosToX(t);
        ctx.fillStyle = this.TICK_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, plotY + plotH + 4);
        ctx.strokeStyle = this.AXIS_COLOR;
        ctx.beginPath();
        ctx.moveTo(x, plotY + plotH);
        ctx.lineTo(x, plotY + plotH + 3);
        ctx.stroke();
      } else {
        // Position on Y axis (left side)
        const y = vPosToY(t);
        ctx.fillStyle = this.TICK_COLOR;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, plotX - 5, y);
        ctx.strokeStyle = this.AXIS_COLOR;
        ctx.beginPath();
        ctx.moveTo(plotX - 3, y);
        ctx.lineTo(plotX, y);
        ctx.stroke();
      }
    }

    //  Axis labels
    ctx.fillStyle = this.LABEL_COLOR;
    ctx.font = '11px monospace';

    if (!isVertical) {
      // Position label: centred below X axis
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(posAxisLabel, plotX + plotW / 2, this.canvas.height - 2);

      // Value label: rotated along left Y axis
      ctx.save();
      ctx.translate(10, plotY + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(valueAxisLabel, 0, 0);
      ctx.restore();
    } else {
      // Value label: centred below X axis (value is on X for vertical scan)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(valueAxisLabel, plotX + plotW / 2, this.canvas.height - 2);

      // Position label: rotated along left Y axis (pos is on Y for vertical scan)
      ctx.save();
      ctx.translate(10, plotY + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(posAxisLabel, 0, 0);
      ctx.restore();
    }
  }

  /**
   * Generate approximately n nicely rounded tick values spanning [lo, hi].
   */
  private niceTicks(lo: number, hi: number, n: number): number[] {
    const range = hi - lo;
    if (range === 0) return [lo];
    const step = this.niceStep(range / n);
    const start = Math.ceil(lo / step) * step;
    const ticks: number[] = [];
    for (let t = start; t <= hi + step * 1e-9; t += step) {
      ticks.push(parseFloat(t.toPrecision(10))); // strip floating-point drift
    }
    return ticks;
  }

  /**
   * Round a step size up to the nearest 1 / 2 / 5 × 10^n.
   */
  private niceStep(rough: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    if (norm < 1.5) return mag;
    if (norm < 3.5) return 2 * mag;
    if (norm < 7.5) return 5 * mag;
    return 10 * mag;
  }

  /**
   * Format a tick value compactly (avoids trailing zeros, uses exp. notation for extremes).
   */
  private formatTick(v: number): string {
    if (v === 0) return '0';
    if (Math.abs(v) >= 10000 || Math.abs(v) < 0.01) return v.toExponential(1);
    return parseFloat(v.toPrecision(3)).toString();
  }
}
