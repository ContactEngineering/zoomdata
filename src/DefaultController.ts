import type { ZoomEngine } from './ZoomEngine.js';

export interface DefaultControllerOptions {
  /** Element receiving input (default: the engine's canvas) */
  element?: HTMLElement;
  /** Zoom factor per wheel notch, i.e. per 100 px of wheel delta (default: 2^0.25) */
  wheelZoomFactor?: number;
  /** Zoom factor per +/- key press (default: 2^0.5) */
  keyZoomFactor?: number;
  /** Fraction of the canvas an arrow key pans (default: 0.1) */
  keyPanFraction?: number;
  /** Smallest scale, as a fraction of the scale that fits the image (default: 0.25) */
  minFitFraction?: number;
  /** Largest scale in CSS pixels per image pixel (default: 64) */
  maxScale?: number;
  /** Degrees the map turns or tips per CSS pixel of an orbit drag (default: 0.4) */
  orbitSpeed?: number;
  /** Enable keyboard input; makes the element focusable (default: true) */
  keyboard?: boolean;
  /** Called on double click / double tap with the image position */
  onDoubleClick?: (imageX: number, imageY: number) => void;
}

/**
 * Default input handling for a ZoomEngine: drag to pan with mouse, pen or
 * one finger; pinch with two fingers; wheel to zoom about the cursor;
 * drag with the right button, or with Shift, to turn and tilt the map;
 * +/-, arrow keys and 0 (fit, looking straight down) on the keyboard.
 *
 * It only calls engine.setView(); hosts with their own gesture handling do
 * not need it.
 */
export class DefaultController {
  private readonly engine: ZoomEngine;
  private readonly element: HTMLElement;
  private readonly options: Required<Omit<DefaultControllerOptions, 'element' | 'onDoubleClick'>>;
  private readonly onDoubleClick: DefaultControllerOptions['onDoubleClick'];

  // Active pointers in element coordinates (CSS pixels)
  private pointers = new Map<number, { x: number; y: number }>();
  private lastTap: { time: number; x: number; y: number } | null = null;
  private orbiting = false;

  private readonly listeners: [string, EventListener, AddEventListenerOptions?][];

  constructor(engine: ZoomEngine, options: DefaultControllerOptions = {}) {
    this.engine = engine;
    this.element = options.element ?? engine.canvas;
    this.onDoubleClick = options.onDoubleClick;
    this.options = {
      wheelZoomFactor: options.wheelZoomFactor ?? 2 ** 0.25,
      keyZoomFactor: options.keyZoomFactor ?? 2 ** 0.5,
      keyPanFraction: options.keyPanFraction ?? 0.1,
      minFitFraction: options.minFitFraction ?? 0.25,
      maxScale: options.maxScale ?? 64,
      orbitSpeed: options.orbitSpeed ?? 0.4,
      keyboard: options.keyboard ?? true,
    };

    this.listeners = [
      ['pointerdown', this.handlePointerDown as EventListener],
      ['pointermove', this.handlePointerMove as EventListener],
      ['pointerup', this.handlePointerUp as EventListener],
      ['pointercancel', this.handlePointerUp as EventListener],
      ['wheel', this.handleWheel as EventListener, { passive: false }],
      ['dblclick', this.handleDblClick as EventListener],
      // The right button turns the map instead of opening a menu
      ['contextmenu', (event: Event) => event.preventDefault()],
    ];
    if (this.options.keyboard) {
      this.listeners.push(['keydown', this.handleKeyDown as EventListener]);
      if (this.element.tabIndex < 0) this.element.tabIndex = 0;
    }
    for (const [type, listener, opts] of this.listeners) {
      this.element.addEventListener(type, listener, opts);
    }
    // Let the controller, not the browser, handle touch gestures
    this.element.style.touchAction = 'none';
    this.element.style.cursor = 'grab';
  }

  /** Remove all listeners */
  dispose(): void {
    for (const [type, listener, opts] of this.listeners) {
      this.element.removeEventListener(type, listener, opts);
    }
  }

  private clampScale(k: number): number {
    const fit = this.engine.fitView().k;
    return Math.min(this.options.maxScale, Math.max(fit * this.options.minFitFraction, k));
  }

  /** Zoom by a factor keeping the point (px, py) (CSS pixels) fixed */
  zoomAbout(factor: number, px: number, py: number): void {
    const view = this.engine.view;
    const k = this.clampScale(view.k * factor);
    const f = k / view.k;
    this.engine.setView({ ...view, k, x: px - f * (px - view.x), y: py - f * (py - view.y) });
  }

  /** Pan by (dx, dy) CSS pixels */
  panBy(dx: number, dy: number): void {
    const view = this.engine.view;
    this.engine.setView({ ...view, x: view.x + dx, y: view.y + dy });
  }

  /**
   * Turn the map by `rotation` degrees and tip it by `tilt` degrees about
   * the point at the centre of the canvas
   */
  orbitBy(rotation: number, tilt: number): void {
    const view = this.engine.view;
    this.engine.setView(this.engine.orbitView(view.rotation + rotation, view.tilt + tilt));
  }

  /** Fit the image into the canvas, looking straight down */
  fit(): void {
    this.engine.setView(this.engine.fitView());
  }

  private position(event: MouseEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
    this.element.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, this.position(event));
    // The right button, or Shift with the left, turns and tilts the map
    this.orbiting = event.pointerType === 'mouse' && (event.button === 2 || event.shiftKey);
    this.element.style.cursor = 'grabbing';

    // Double tap on touch screens (dblclick covers mouse)
    if (event.pointerType === 'touch' && this.pointers.size === 1) {
      const p = this.position(event);
      const last = this.lastTap;
      if (
        last &&
        event.timeStamp - last.time < 300 &&
        Math.hypot(p.x - last.x, p.y - last.y) < 20
      ) {
        this.doubleClick(p.x, p.y);
        this.lastTap = null;
      } else {
        this.lastTap = { time: event.timeStamp, ...p };
      }
    }
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const current = this.position(event);

    if (this.pointers.size === 1) {
      this.pointers.set(event.pointerId, current);
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      // Dragging sideways turns the map, dragging up tips it back
      if (this.orbiting) this.orbitBy(dx * this.options.orbitSpeed, -dy * this.options.orbitSpeed);
      else this.panBy(dx, dy);
      return;
    }

    // Pinch: keep the image point under the pointers' midpoint under it,
    // and scale with their distance
    const [a, b] = [...this.pointers.entries()];
    const other = a[0] === event.pointerId ? b[1] : a[1];
    const midBefore = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
    const midAfter = { x: (current.x + other.x) / 2, y: (current.y + other.y) / 2 };
    const distBefore = Math.hypot(previous.x - other.x, previous.y - other.y);
    const distAfter = Math.hypot(current.x - other.x, current.y - other.y);
    this.pointers.set(event.pointerId, current);
    if (distBefore > 0) this.zoomAbout(distAfter / distBefore, midBefore.x, midBefore.y);
    this.panBy(midAfter.x - midBefore.x, midAfter.y - midBefore.y);
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.element.style.cursor = 'grab';
  };

  private readonly handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    // Normalise line and page deltas to pixels
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const notches = (event.deltaY * scale) / 100;
    const p = this.position(event);
    this.zoomAbout(this.options.wheelZoomFactor ** -notches, p.x, p.y);
  };

  private readonly handleDblClick = (event: MouseEvent) => {
    const p = this.position(event);
    this.doubleClick(p.x, p.y);
  };

  private doubleClick(x: number, y: number): void {
    if (!this.onDoubleClick) return;
    // The point of the surface there, in the tilted view
    const p = this.engine.pick(x, y);
    this.onDoubleClick(p.x, p.y);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    const { width, height } = this.engine.size;
    const pan = this.options.keyPanFraction;
    const zoom = this.options.keyZoomFactor;
    switch (event.key) {
      case '+':
      case '=':
        this.zoomAbout(zoom, width / 2, height / 2);
        break;
      case '-':
      case '_':
        this.zoomAbout(1 / zoom, width / 2, height / 2);
        break;
      case 'ArrowLeft':
        this.panBy(pan * width, 0);
        break;
      case 'ArrowRight':
        this.panBy(-pan * width, 0);
        break;
      case 'ArrowUp':
        this.panBy(0, pan * height);
        break;
      case 'ArrowDown':
        this.panBy(0, -pan * height);
        break;
      case '0':
        this.fit();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}
