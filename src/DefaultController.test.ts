import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultController } from './DefaultController';
import type { View, ZoomEngine } from './ZoomEngine';

/** Engine stand-in: a 400 x 300 canvas showing a 1000 x 500 image */
function fakeEngine() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  let view: View = { k: 0.4, x: 0, y: 50 };
  const engine = {
    canvas,
    size: { width: 400, height: 300 },
    get view() {
      return { ...view };
    },
    setView: vi.fn((v: View) => {
      view = { ...v };
    }),
    fitView: () => ({ k: 0.4, x: 0, y: 50 }),
    screenToImage: (x: number, y: number) => ({
      x: (x - view.x) / view.k,
      y: (y - view.y) / view.k,
    }),
  };
  return engine;
}

let engine: ReturnType<typeof fakeEngine>;
let controller: DefaultController;

function pointer(type: string, id: number, x: number, y: number, pointerType = 'touch') {
  engine.canvas.dispatchEvent(
    new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType, button: 0 }),
  );
}

beforeEach(() => {
  engine = fakeEngine();
  controller = new DefaultController(engine as unknown as ZoomEngine);
});

afterEach(() => {
  controller.dispose();
  engine.canvas.remove();
});

/** Image point under a screen point */
function imageAt(x: number, y: number) {
  return engine.screenToImage(x, y);
}

describe('DefaultController', () => {
  it('pans with a single pointer', () => {
    pointer('pointerdown', 1, 100, 100, 'mouse');
    pointer('pointermove', 1, 130, 90, 'mouse');
    pointer('pointerup', 1, 130, 90, 'mouse');
    expect(engine.view).toEqual({ k: 0.4, x: 30, y: 40 });
    // Moving without a pressed pointer does nothing
    pointer('pointermove', 1, 200, 200, 'mouse');
    expect(engine.view).toEqual({ k: 0.4, x: 30, y: 40 });
  });

  it('zooms about the cursor with the wheel', () => {
    const before = imageAt(120, 80);
    // happy-dom's WheelEvent ignores the mouse position in its init dict
    const wheel = new WheelEvent('wheel', { deltaY: -100 });
    Object.defineProperties(wheel, { clientX: { value: 120 }, clientY: { value: 80 } });
    engine.canvas.dispatchEvent(wheel);
    expect(engine.view.k).toBeCloseTo(0.4 * 2 ** 0.25, 12);
    const after = imageAt(120, 80);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('pinches about the midpoint of two fingers', () => {
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    const before = imageAt(150, 100);
    // Fingers move apart symmetrically: distance doubles, midpoint fixed
    pointer('pointermove', 1, 50, 100);
    pointer('pointermove', 2, 250, 100);
    expect(engine.view.k).toBeCloseTo(0.8, 9);
    const after = imageAt(150, 100);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('clamps the scale', () => {
    for (let i = 0; i < 100; i++) {
      engine.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    }
    expect(engine.view.k).toBe(64);
    for (let i = 0; i < 200; i++) {
      engine.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    }
    expect(engine.view.k).toBeCloseTo(0.1, 12);
  });

  it('handles the keyboard', () => {
    const key = (k: string) =>
      engine.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }));
    expect(engine.canvas.tabIndex).toBe(0);
    key('ArrowRight');
    expect(engine.view).toEqual({ k: 0.4, x: -40, y: 50 });
    key('ArrowDown');
    expect(engine.view).toEqual({ k: 0.4, x: -40, y: 20 });
    const centre = imageAt(200, 150);
    key('+');
    expect(engine.view.k).toBeCloseTo(0.4 * Math.SQRT2, 12);
    expect(imageAt(200, 150).x).toBeCloseTo(centre.x, 9);
    key('0');
    expect(engine.view).toEqual({ k: 0.4, x: 0, y: 50 });
  });

  it('reports double clicks and double taps in image coordinates', () => {
    controller.dispose();
    const onDoubleClick = vi.fn();
    controller = new DefaultController(engine as unknown as ZoomEngine, { onDoubleClick });
    engine.canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 40, clientY: 90 }));
    expect(onDoubleClick).toHaveBeenLastCalledWith(100, 100);

    pointer('pointerdown', 3, 80, 50);
    pointer('pointerup', 3, 80, 50);
    pointer('pointerdown', 4, 82, 51);
    pointer('pointerup', 4, 82, 51);
    expect(onDoubleClick).toHaveBeenCalledTimes(2);
    expect(onDoubleClick).toHaveBeenLastCalledWith(205, 2.5);
  });

  it('removes its listeners on dispose', () => {
    controller.dispose();
    engine.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(engine.setView).not.toHaveBeenCalled();
  });
});
