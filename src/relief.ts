/**
 * Relief shading: the map is lit from one direction, so that slopes facing
 * the light are brighter and slopes facing away are darker. This shows fine
 * structure that the colours alone do not resolve.
 */

export interface ReliefOptions {
  /**
   * Direction the light comes from, in degrees clockwise from the top of
   * the screen (default: 315, the top left)
   */
  azimuth?: number;
  /** Height of the light above the horizon in degrees (default: 45) */
  altitude?: number;
  /** Vertical exaggeration: slopes are multiplied by it (default: 1) */
  exaggeration?: number;
  /** Share of the light that reaches every surface, 0 to 1 (default: 0.3) */
  ambient?: number;
}

export const DEFAULT_RELIEF: Required<ReliefOptions> = {
  azimuth: 315,
  altitude: 45,
  exaggeration: 1,
  ambient: 0.3,
};

/** Options with defaults filled in; null or false switches relief off */
export function resolveRelief(
  relief: ReliefOptions | boolean | null | undefined,
): Required<ReliefOptions> | null {
  if (!relief) return null;
  const options = { ...DEFAULT_RELIEF, ...(relief === true ? {} : relief) };
  if (!(options.altitude > 0 && options.altitude <= 90)) {
    throw new Error(`Relief: altitude ${options.altitude} is not in (0, 90]`);
  }
  if (!(options.ambient >= 0 && options.ambient <= 1)) {
    throw new Error(`Relief: ambient ${options.ambient} is not in [0, 1]`);
  }
  return options;
}

/**
 * Unit vector towards the light, in map coordinates: x to the right, y down
 * the screen, z out of the screen
 */
export function lightVector(azimuth: number, altitude: number): [number, number, number] {
  const az = (azimuth * Math.PI) / 180;
  const alt = (altitude * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), Math.sin(alt)];
}

/**
 * Brightness factor of a surface with slopes dh/dx and dh/dy (y down the
 * screen): 1 for a level surface, more where it faces the light (at most
 * 1 / sin(altitude)), down to `ambient` where it faces away.
 */
export function reliefFactor(
  slopeX: number,
  slopeY: number,
  relief: Required<ReliefOptions>,
): number {
  const gx = relief.exaggeration * slopeX;
  const gy = relief.exaggeration * slopeY;
  // Unit normal of the surface z = h(x, y)
  const norm = Math.hypot(gx, gy, 1);
  const [lx, ly, lz] = lightVector(relief.azimuth, relief.altitude);
  const diffuse = Math.max(0, (-gx * lx - gy * ly + lz) / norm);
  return relief.ambient + ((1 - relief.ambient) * diffuse) / lz;
}

// Length units as SurfaceTopography writes them, with their UTF-8 forms
const LENGTH_UNITS: Record<string, number> = {
  Gm: 1e9,
  Mm: 1e6,
  km: 1e3,
  m: 1,
  cm: 1e-2,
  mm: 1e-3,
  um: 1e-6,
  µm: 1e-6, // U+00B5 micro sign
  μm: 1e-6, // U+03BC Greek mu
  nm: 1e-9,
  A: 1e-10,
  Å: 1e-10,
  pm: 1e-12,
  fm: 1e-15,
};

/** Length of a unit in metres, or null if the unit is not a known length */
export function lengthInMeters(unit: string | null | undefined): number | null {
  if (!unit) return null;
  return LENGTH_UNITS[unit.trim()] ?? null;
}
