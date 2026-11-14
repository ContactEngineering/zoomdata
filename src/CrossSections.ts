import { LineScanRenderer, type LineScanData } from './LineScanRenderer.js';
import type { ZoomEngine } from './ZoomEngine.js';

/** Values along a horizontal or vertical line through the image */
export interface Profile {
  /** Values in physical units, NaN where undefined or not loaded */
  values: Float64Array;
  /** Image coordinate along the line of each value (first point of its block) */
  positions: Float64Array;
  /** Level the profile was sampled at, and its stride */
  level: number;
  stride: number;
}

/**
 * Sample a profile along a row (axis 'x', at = image y) or column (axis
 * 'y', at = image x) between the image coordinates `from` and `to`, at the
 * given level: one value per pixel of the level, read with sampleAt from
 * that level, or a coarser one where it is not loaded.
 */
export function sampleProfile(
  engine: ZoomEngine,
  axis: 'x' | 'y',
  at: number,
  from: number,
  to: number,
  level: number = engine.level,
): Profile {
  const geometry = engine.config.geometry;
  const stride = geometry.stride(level);
  const length = axis === 'x' ? geometry.width : geometry.height;
  const i0 = Math.max(0, Math.floor(Math.min(from, to) / stride));
  const i1 = Math.min(Math.ceil(length / stride), Math.ceil(Math.max(from, to) / stride));
  const n = Math.max(0, i1 - i0);
  const values = new Float64Array(n);
  const positions = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    // A value is located at the first point of its block, as in the tiles'
    // coordinate variables (see docs/pyramid-format.md)
    const p = (i0 + j) * stride;
    const s = axis === 'x' ? engine.sampleAt(p, at, level) : engine.sampleAt(at, p, level);
    values[j] = s ? s.value : NaN;
    positions[j] = p;
  }
  return { values, positions, level, stride };
}

export interface CrossSectionsOptions {
  /** Canvas for the profile along the row through the crosshair */
  horizontalCanvas?: HTMLCanvasElement;
  /** Canvas for the profile along the column through the crosshair */
  verticalCanvas?: HTMLCanvasElement;
  /** Transparent canvas on top of the engine's canvas for the crosshair */
  overlayCanvas?: HTMLCanvasElement;
  /**
   * Fit the value axis of each profile to its values instead of to the
   * range of the whole map (default: false)
   */
  fitValueAxis?: boolean;
  /** Called when the crosshair is placed, moved or cleared */
  onChange?: (position: { x: number; y: number } | null) => void;
}

let nextId = 0;

/**
 * Crosshair with horizontal and vertical cross-sections through it.
 *
 * The profiles cover the visible part of the image at the level drawn for
 * the view. Values come from the engine's sampling API; tiles along the
 * lines that are outside the view are requested through the engine's
 * loader.
 */
export class CrossSections {
  private readonly engine: ZoomEngine;
  private readonly options: CrossSectionsOptions;
  private readonly owner = `cross-sections-${nextId++}`;
  private readonly horizontal: LineScanRenderer | null;
  private readonly vertical: LineScanRenderer | null;
  private readonly unsubscribe: (() => void)[];
  private position: { x: number; y: number } | null = null;

  constructor(engine: ZoomEngine, options: CrossSectionsOptions = {}) {
    this.engine = engine;
    this.options = options;
    this.horizontal = options.horizontalCanvas
      ? new LineScanRenderer(options.horizontalCanvas)
      : null;
    this.vertical = options.verticalCanvas ? new LineScanRenderer(options.verticalCanvas) : null;
    this.horizontal?.drawEmpty();
    this.vertical?.drawEmpty();
    this.unsubscribe = [
      engine.on('render', () => this.drawCrosshair()),
      engine.on('view', () => this.update()),
      engine.on('tiles', () => this.drawProfiles()),
    ];
  }

  /** Crosshair position in image pixels, or null */
  get crosshair(): { x: number; y: number } | null {
    return this.position ? { ...this.position } : null;
  }

  /**
   * Place the crosshair at an image position (clamped to the image)
   */
  place(imageX: number, imageY: number): void {
    const { width, height } = this.engine.config.geometry;
    this.position = {
      x: Math.max(0, Math.min(width - 1, imageX)),
      y: Math.max(0, Math.min(height - 1, imageY)),
    };
    this.options.onChange?.(this.crosshair);
    this.update();
    this.engine.scheduleRender();
  }

  /**
   * Remove the crosshair and empty the profiles
   */
  clear(): void {
    this.position = null;
    this.options.onChange?.(null);
    this.engine.requestTiles(this.owner, []);
    this.horizontal?.drawEmpty();
    this.vertical?.drawEmpty();
    this.engine.scheduleRender();
  }

  /** Profile along the row through the crosshair, over the visible part */
  horizontalProfile(): Profile | null {
    if (!this.position) return null;
    const r = this.engine.visibleImageRect();
    return sampleProfile(this.engine, 'x', this.position.y, r.x0, r.x1);
  }

  /** Profile along the column through the crosshair, over the visible part */
  verticalProfile(): Profile | null {
    if (!this.position) return null;
    const r = this.engine.visibleImageRect();
    return sampleProfile(this.engine, 'y', this.position.x, r.y0, r.y1);
  }

  /**
   * Draw the profiles again, e.g. after their canvases changed size
   */
  redraw(): void {
    if (this.position) {
      this.drawProfiles();
    } else {
      this.horizontal?.drawEmpty();
      this.vertical?.drawEmpty();
    }
  }

  /** Request the tiles along both lines and redraw the profiles */
  private update(): void {
    if (!this.position) return;
    const geometry = this.engine.config.geometry;
    const level = this.engine.level;
    const r = this.engine.visibleImageRect();
    const { x, y } = this.position;
    this.engine.requestTiles(this.owner, [
      ...geometry.tilesInRect(level, { x0: r.x0, x1: r.x1, y0: y, y1: y + 1e-6 }),
      ...geometry.tilesInRect(level, { x0: x, x1: x + 1e-6, y0: r.y0, y1: r.y1 }),
    ]);
    this.drawProfiles();
  }

  private drawProfiles(): void {
    if (!this.position) return;
    const config = this.engine.config;
    const r = this.engine.visibleImageRect();

    // Positions in µm if the pixel size is known, else in image pixels
    const ppm = config.pixelsPerMeter;
    const toX = ppm ? (p: number) => (p / ppm.Width) * 1e6 : (p: number) => p;
    const toY = ppm ? (p: number) => (p / ppm.Height) * 1e6 : (p: number) => p;
    const unit = ppm ? ' (µm)' : ' (px)';

    const range = config.colorbarRange;
    const draw = (
      renderer: LineScanRenderer | null,
      profile: Profile | null,
      orientation: 'horizontal' | 'vertical',
    ) => {
      if (!renderer) return;
      if (!profile || profile.values.length === 0) {
        renderer.drawEmpty();
        return;
      }
      const horizontal = orientation === 'horizontal';
      const map = horizontal ? toX : toY;
      const { min, max } =
        range && !this.options.fitValueAxis
          ? { min: range.Minimum, max: range.Maximum }
          : finiteRange(profile.values);
      const data: LineScanData = {
        values: profile.values,
        positions: profile.positions.map(map),
        crosshairPos: map(horizontal ? this.position!.x : this.position!.y),
        posMin: map(horizontal ? r.x0 : r.y0),
        posMax: map(horizontal ? r.x1 : r.y1),
        posAxisLabel: (horizontal ? 'x-position' : 'y-position') + unit,
        valueAxisLabel: config.colorbarTitle,
        orientation,
        valueMin: min,
        valueMax: max,
      };
      renderer.draw(data);
    };
    draw(this.horizontal, this.horizontalProfile(), 'horizontal');
    draw(this.vertical, this.verticalProfile(), 'vertical');
  }

  private drawCrosshair(): void {
    const overlay = this.options.overlayCanvas;
    if (!overlay) return;

    // Keep overlay size in sync with main canvas
    const { width, height } = this.engine.size;
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!this.position) return;

    // Convert image pixel coordinates to screen coordinates
    const { x: screenX, y: screenY } = this.engine.imageToScreen(this.position.x, this.position.y);

    ctx.strokeStyle = 'rgba(255, 75, 75, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(overlay.width, screenY);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, overlay.height);
    ctx.stroke();

    ctx.setLineDash([]);

    // Dot at intersection with white ring
    ctx.fillStyle = 'rgba(255, 75, 75, 0.9)';
    ctx.beginPath();
    ctx.arc(screenX, screenY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 4.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.engine.requestTiles(this.owner, []);
  }
}

function finiteRange(values: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 0.5, max: max + 0.5 };
  return { min, max };
}
