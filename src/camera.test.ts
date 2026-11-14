import { describe, expect, it } from 'vitest';
import { footprint, isPlain, MAX_TILT, orbit, project, unproject, type Camera } from './camera.js';

const plain: Camera = { k: 2, tx: 10, ty: 20, rotation: 0, tilt: 0 };

function closeTo(actual: Record<string, number>, expected: Record<string, number>) {
  for (const [key, value] of Object.entries(expected)) expect(actual[key]).toBeCloseTo(value, 9);
}

describe('project', () => {
  it('is screen = k image + t in the plain view, whatever the height', () => {
    closeTo(project(plain, 3, 4), { x: 16, y: 28 });
    closeTo(project(plain, 3, 4, 100), { x: 16, y: 28 });
    expect(isPlain(plain)).toBe(true);
    expect(isPlain({ rotation: 0, tilt: 10 })).toBe(false);
  });

  it('turns the map clockwise on screen', () => {
    // The x axis of the map points down the screen after a quarter turn
    closeTo(project({ ...plain, rotation: 90 }, 5, 0), { x: 10, y: 30 });
    closeTo(project({ ...plain, rotation: 90 }, 0, 5), { x: 0, y: 20 });
    closeTo(project({ ...plain, rotation: 180 }, 5, 1), { x: 0, y: 18 });
  });

  it('foreshortens the map along the screen when tilted and raises high points', () => {
    const tilted = { ...plain, tilt: 60 };
    // cos(60°) = 0.5: 10 image pixels down the map are 5 * k on screen
    closeTo(project(tilted, 0, 10), { x: 10, y: 30 });
    // Across the screen nothing changes
    closeTo(project(tilted, 10, 0), { x: 30, y: 20 });
    // A point 10 pixels high moves up the screen by 10 k sin(60°)
    closeTo(project(tilted, 0, 0, 10), { x: 10, y: 20 - 20 * Math.sin(Math.PI / 3) });
  });

  it('puts near and high points in front', () => {
    const tilted = { ...plain, tilt: 30 };
    const far = project(tilted, 0, 0).depth;
    expect(project(tilted, 0, 10).depth).toBeGreaterThan(far);
    expect(project(tilted, 0, 0, 10).depth).toBeGreaterThan(far);
    // Looking straight down, only the height counts
    expect(project(plain, 7, 9, 1).depth).toBeCloseTo(2, 12);
  });
});

describe('unproject', () => {
  it('inverts project at any height', () => {
    const camera: Camera = { k: 1.7, tx: -30, ty: 12, rotation: 37, tilt: 55 };
    for (const [u, v, z] of [
      [0, 0, 0],
      [120.5, -40, 0],
      [3, 99, 25],
      [-7, 8, -12],
    ]) {
      const p = project(camera, u, v, z);
      closeTo(unproject(camera, p.x, p.y, z), { u, v });
    }
  });
});

describe('footprint', () => {
  it('is the screen rectangle in image pixels in the plain view', () => {
    closeTo(footprint(plain, 200, 100), { x0: -5, y0: -10, x1: 95, y1: 40 });
  });

  it('grows along the view direction with the tilt', () => {
    // 1 / cos(60°) = 2
    closeTo(footprint({ ...plain, tilt: 60 }, 200, 100), { x0: -5, y0: -20, x1: 95, y1: 80 });
  });

  it('includes high and low points that project into the screen', () => {
    const tilted = { ...plain, tilt: 60 };
    const tan = Math.tan(Math.PI / 3);
    // A point at height z shows where the plane point z tan(tilt) further up does
    closeTo(footprint(tilted, 200, 100, -3, 5), {
      x0: -5,
      y0: -20 - 3 * tan,
      x1: 95,
      y1: 80 + 5 * tan,
    });
  });

  it('is the bounding box of the turned screen rectangle', () => {
    closeTo(footprint({ ...plain, tx: 0, ty: 0, rotation: 90 }, 200, 100), {
      x0: 0,
      y0: -100,
      x1: 50,
      y1: 0,
    });
  });
});

describe('orbit', () => {
  it('keeps the pivot on the same point of the map', () => {
    const before = unproject(plain, 100, 80);
    const turned = orbit(plain, 40, 50, 100, 80);
    expect([turned.rotation, turned.tilt, turned.k]).toEqual([40, 50, 2]);
    closeTo(unproject(turned, 100, 80), before);
    // Other points move
    expect(unproject(turned, 0, 0).u).not.toBeCloseTo(unproject(plain, 0, 0).u, 3);
  });

  it('limits the tilt and wraps the rotation', () => {
    expect(orbit(plain, 0, 89, 0, 0).tilt).toBe(MAX_TILT);
    expect(orbit(plain, 0, -5, 0, 0).tilt).toBe(0);
    expect(orbit(plain, 370, 0, 0, 0).rotation).toBe(10);
    expect(orbit(plain, -90, 0, 0, 0).rotation).toBe(270);
  });
});
