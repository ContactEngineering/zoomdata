import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultController } from './DefaultController.js';
import { orbit, unproject } from './camera.js';
import type { View, ZoomEngine } from './ZoomEngine.js';

/** Engine stand-in: a 400 x 300 canvas showing a 1000 x 500 image */
function fakeEngine() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const fit: Required<View> = { k: 0.4, x: 0, y: 50, rotation: 0, tilt: 0 };
  let view = { ...fit };
  const camera = () => ({
    k: view.k,
    tx: view.x,
    ty: view.y,
    rotation: view.rotation,
    tilt: view.tilt,
  });
  const screenToImage = (x: number, y: number) => {
    const p = unproject(camera(), x, y);
    return { x: p.u, y: p.v };
  };
  const engine = {
    canvas,
    size: { width: 400, height: 300 },
    get view() {
      return { ...view };
    },
    setView: vi.fn((v: View) => {
      view = { rotation: 0, tilt: 0, ...v };
    }),
    fitView: () => ({ ...fit }),
    orbitView: (rotation: number, tilt: number, pivot = { x: 200, y: 150 }) => {
      const c = orbit(camera(), rotation, tilt, pivot.x, pivot.y);
      return { k: c.k, x: c.tx, y: c.ty, rotation: c.rotation, tilt: c.tilt };
    },
    screenToImage,
    pick: (x: number, y: number) => ({ ...screenToImage(x, y), sample: null }),
  };
  return engine;
}

let engine: ReturnType<typeof fakeEngine>;
let controller: DefaultController;

function pointer(
  type: string,
  id: number,
  x: number,
  y: number,
  pointerType = 'touch',
  init: PointerEventInit = {},
) {
  engine.canvas.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      clientX: x,
      clientY: y,
      pointerType,
      button: 0,
      ...init,
    }),
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
    expect(engine.view).toEqual({ k: 0.4, x: 30, y: 40, rotation: 0, tilt: 0 });
    // Moving without a pressed pointer does nothing
    pointer('pointermove', 1, 200, 200, 'mouse');
    expect(engine.view).toEqual({ k: 0.4, x: 30, y: 40, rotation: 0, tilt: 0 });
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
    expect(engine.view).toEqual({ k: 0.4, x: -40, y: 50, rotation: 0, tilt: 0 });
    key('ArrowDown');
    expect(engine.view).toEqual({ k: 0.4, x: -40, y: 20, rotation: 0, tilt: 0 });
    const centre = imageAt(200, 150);
    key('+');
    expect(engine.view.k).toBeCloseTo(0.4 * Math.SQRT2, 12);
    expect(imageAt(200, 150).x).toBeCloseTo(centre.x, 9);
    key('0');
    expect(engine.view).toEqual({ k: 0.4, x: 0, y: 50, rotation: 0, tilt: 0 });
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

  it('turns and tilts the map about the centre of the canvas with the right button', () => {
    const centre = imageAt(200, 150);
    pointer('pointerdown', 1, 100, 100, 'mouse', { button: 2 });
    // 50 px to the right and 100 px up: 0.4 degrees per pixel
    pointer('pointermove', 1, 150, 0, 'mouse', { button: 2 });
    pointer('pointerup', 1, 150, 0, 'mouse', { button: 2 });
    expect(engine.view.rotation).toBeCloseTo(20, 9);
    expect(engine.view.tilt).toBeCloseTo(40, 9);
    expect(engine.view.k).toBe(0.4);
    const after = imageAt(200, 150);
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.y).toBeCloseTo(centre.y, 9);
  });

  it('turns the map with Shift and the left button, and stops at the limits', () => {
    pointer('pointerdown', 1, 100, 100, 'mouse', { shiftKey: true });
    pointer('pointermove', 1, 100, -400, 'mouse', { shiftKey: true });
    expect(engine.view.tilt).toBe(75);
    pointer('pointermove', 1, 100, 900, 'mouse', { shiftKey: true });
    expect(engine.view.tilt).toBe(0);
    pointer('pointerup', 1, 100, 900, 'mouse');
    // Without Shift the next drag pans again
    const view = engine.view;
    pointer('pointerdown', 2, 100, 100, 'mouse');
    pointer('pointermove', 2, 110, 100, 'mouse');
    expect(engine.view).toEqual({ ...view, x: view.x + 10 });
  });

  it('keeps the orientation while panning and zooming, and resets it when fitting', () => {
    controller.orbitBy(30, 45);
    controller.panBy(10, 5);
    controller.zoomAbout(2, 100, 100);
    expect([engine.view.rotation, engine.view.tilt, engine.view.k]).toEqual([30, 45, 0.8]);
    controller.fit();
    expect(engine.view).toEqual({ k: 0.4, x: 0, y: 50, rotation: 0, tilt: 0 });
  });

  describe('two fingers twisting', () => {
    // Two fingers 100 px either side of (200, 150); the second turns about
    // the first by `degrees`
    const second = (degrees: number) => {
      const a = (degrees * Math.PI) / 180;
      return [100 + 200 * Math.cos(a), 150 + 200 * Math.sin(a)] as const;
    };
    const start = () => {
      pointer('pointerdown', 1, 100, 150);
      pointer('pointerdown', 2, ...second(0));
    };

    it('turn the map once they have twisted by 10 degrees, then follow', () => {
      start();
      pointer('pointermove', 2, ...second(6));
      expect(engine.view.rotation).toBe(0);
      // Past the threshold: the map turns by this move, clockwise like the fingers
      pointer('pointermove', 2, ...second(14));
      expect(engine.view.rotation).toBeCloseTo(8, 9);
      pointer('pointermove', 2, ...second(44));
      expect(engine.view.rotation).toBeCloseTo(38, 9);
      // And back, also below the threshold now
      pointer('pointermove', 2, ...second(40));
      expect(engine.view.rotation).toBeCloseTo(34, 9);
      expect(engine.view.tilt).toBe(0);
    });

    it('turn it about the point between them', () => {
      start();
      pointer('pointermove', 2, ...second(12));
      // The fingers are at (100, 150) and second(12); the map point that
      // was between them before the last move is between them still
      const [x, y] = second(12);
      const mid = { x: (100 + x) / 2, y: (150 + y) / 2 };
      const under = imageAt(mid.x, mid.y);
      pointer('pointermove', 2, ...second(40));
      const [x2, y2] = second(40);
      const after = imageAt((100 + x2) / 2, (150 + y2) / 2);
      expect(after.x).toBeCloseTo(under.x, 6);
      expect(after.y).toBeCloseTo(under.y, 6);
      // The fingers stayed 200 px apart: no zoom
      expect(engine.view.k).toBeCloseTo(0.4, 9);
    });

    it('turn it anticlockwise too, across the direction where angles wrap', () => {
      pointer('pointerdown', 1, 300, 150);
      // The second finger is to the left of the first: at 180 degrees
      pointer('pointerdown', 2, 100, 150);
      const at = (degrees: number) => {
        const a = (degrees * Math.PI) / 180;
        return [300 + 200 * Math.cos(a), 150 + 200 * Math.sin(a)] as const;
      };
      pointer('pointermove', 2, ...at(175));
      pointer('pointermove', 2, ...at(165));
      // Past the threshold on the second move: 10 degrees anticlockwise
      expect(engine.view.rotation).toBeCloseTo(350, 9);
      // From 165 through 180 to -170 degrees is 25 degrees clockwise
      pointer('pointermove', 2, ...at(-170));
      expect(engine.view.rotation).toBeCloseTo(15, 9);
    });

    it('do not turn it while pinching or dragging', () => {
      start();
      // Apart, together and sideways, with a twist of a few degrees
      pointer('pointermove', 2, 380, 160);
      pointer('pointermove', 1, 60, 145);
      pointer('pointermove', 2, 330, 150);
      pointer('pointermove', 1, 90, 170);
      expect(engine.view.rotation).toBe(0);
      expect(engine.view.k).not.toBeCloseTo(0.4, 3);
    });

    it('start afresh with every gesture', () => {
      start();
      pointer('pointermove', 2, ...second(8));
      pointer('pointerup', 2, ...second(8));
      // The 8 degrees of the last gesture do not count towards this one
      pointer('pointerdown', 3, ...second(8));
      pointer('pointermove', 3, ...second(14));
      expect(engine.view.rotation).toBe(0);
    });
  });

  it('does not open the context menu', () => {
    const event = new MouseEvent('contextmenu', { cancelable: true });
    engine.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('removes its listeners on dispose', () => {
    controller.dispose();
    engine.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(engine.setView).not.toHaveBeenCalled();
  });
});
