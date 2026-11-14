import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELIEF,
  lengthInMeters,
  lightVector,
  reliefFactor,
  resolveRelief,
} from './relief.js';

describe('lightVector', () => {
  it('points to where the light comes from, clockwise from the top of the screen', () => {
    const c = Math.SQRT1_2;
    const close = (a: number[], b: number[]) =>
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
    // y points down the screen: light from the top has negative y
    close(lightVector(0, 45), [0, -c, c]);
    close(lightVector(90, 45), [c, 0, c]);
    close(lightVector(180, 45), [0, c, c]);
    close(lightVector(315, 45), [-0.5, -0.5, c]);
    close(lightVector(123, 90), [0, 0, 1]);
  });
});

describe('reliefFactor', () => {
  const relief = { ...DEFAULT_RELIEF, ambient: 0 };

  it('is 1 on a level surface, whatever the light', () => {
    expect(reliefFactor(0, 0, relief)).toBeCloseTo(1, 12);
    expect(reliefFactor(0, 0, { ...relief, azimuth: 20, altitude: 10 })).toBeCloseTo(1, 12);
    expect(reliefFactor(0, 0, DEFAULT_RELIEF)).toBeCloseTo(1, 12);
  });

  it('is brightest where the surface faces the light', () => {
    // Light from the left at 45 degrees: a surface rising to the right at
    // 45 degrees faces it squarely
    const fromLeft = { ...relief, azimuth: 270 };
    expect(reliefFactor(1, 0, fromLeft)).toBeCloseTo(Math.SQRT2, 12);
    expect(reliefFactor(0.5, 0, fromLeft)).toBeLessThan(Math.SQRT2);
    expect(reliefFactor(2, 0, fromLeft)).toBeLessThan(Math.SQRT2);
  });

  it('is dark where the surface faces away', () => {
    const fromLeft = { ...relief, azimuth: 270 };
    // Falling to the right at 45 degrees: the light grazes the surface
    expect(reliefFactor(-1, 0, fromLeft)).toBeCloseTo(0, 12);
    // Steeper: in shadow, not negative
    expect(reliefFactor(-5, 0, fromLeft)).toBe(0);
    // Ambient light still reaches it
    expect(reliefFactor(-5, 0, { ...fromLeft, ambient: 0.3 })).toBeCloseTo(0.3, 12);
  });

  it('treats y as pointing down the screen', () => {
    // Light from the top: a surface rising towards the bottom faces it
    const fromTop = { ...relief, azimuth: 0 };
    expect(reliefFactor(0, 1, fromTop)).toBeCloseTo(Math.SQRT2, 12);
    expect(reliefFactor(0, -1, fromTop)).toBeCloseTo(0, 12);
    // Slopes across the light direction only tilt the surface away a little
    expect(reliefFactor(1, 0, fromTop)).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('multiplies slopes by the exaggeration', () => {
    const fromLeft = { ...relief, azimuth: 270 };
    expect(reliefFactor(0.1, 0, { ...fromLeft, exaggeration: 10 })).toBeCloseTo(
      reliefFactor(1, 0, fromLeft),
      12,
    );
  });
});

describe('resolveRelief', () => {
  it('fills in defaults and switches off', () => {
    expect(resolveRelief(true)).toEqual(DEFAULT_RELIEF);
    expect(resolveRelief({ azimuth: 90 })).toEqual({ ...DEFAULT_RELIEF, azimuth: 90 });
    expect(resolveRelief(false)).toBeNull();
    expect(resolveRelief(null)).toBeNull();
    expect(resolveRelief(undefined)).toBeNull();
  });

  it('rejects a light at or below the horizon and impossible ambient light', () => {
    expect(() => resolveRelief({ altitude: 0 })).toThrow('altitude');
    expect(() => resolveRelief({ altitude: 91 })).toThrow('altitude');
    expect(() => resolveRelief({ ambient: 1.5 })).toThrow('ambient');
  });
});

describe('lengthInMeters', () => {
  it('knows the units SurfaceTopography writes', () => {
    expect(lengthInMeters('um')).toBe(1e-6);
    expect(lengthInMeters('µm')).toBe(1e-6);
    expect(lengthInMeters('μm')).toBe(1e-6);
    expect(lengthInMeters('nm')).toBe(1e-9);
    expect(lengthInMeters('A')).toBe(1e-10);
    expect(lengthInMeters('Å')).toBe(1e-10);
    expect(lengthInMeters(' mm ')).toBe(1e-3);
    expect(lengthInMeters('m')).toBe(1);
  });

  it('returns null for anything else', () => {
    expect(lengthInMeters('V')).toBeNull();
    expect(lengthInMeters('')).toBeNull();
    expect(lengthInMeters(null)).toBeNull();
    expect(lengthInMeters(undefined)).toBeNull();
  });
});
