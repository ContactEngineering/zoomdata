/**
 * Orthographic camera for the tilted, rotated view of a map.
 *
 * A point of the map has image coordinates (u, v) in image pixels, v down
 * the screen in the plain view, and a height z above the reference plane, in
 * image pixels too. The camera turns the map by `rotation` about the axis
 * normal to it, tips it back by `tilt` about the horizontal axis of the
 * screen, scales by `k` and shifts by (tx, ty):
 *
 *   xr = u cos(rotation) - v sin(rotation)
 *   yr = u sin(rotation) + v cos(rotation)
 *   x  = k xr + tx
 *   y  = k (yr cos(tilt) - z sin(tilt)) + ty
 *
 * With rotation and tilt zero this is the plain view, screen = k image + t.
 * The projection is orthographic: the scale is the same everywhere, so one
 * pyramid level serves the whole view, and lengths across the screen are
 * not distorted.
 */

/** Largest tilt in degrees: the view stays at least 15 degrees above the map */
export const MAX_TILT = 75;

export interface Camera {
  /** Screen pixels per image pixel */
  k: number;
  /** Screen position of the image origin at height 0 */
  tx: number;
  ty: number;
  /** Rotation of the map in degrees, clockwise on screen */
  rotation: number;
  /** Tilt in degrees: 0 looks straight down, larger values tip the far side away */
  tilt: number;
}

const RAD = Math.PI / 180;

/** Whether the camera shows the plain, untilted and unrotated view */
export function isPlain(camera: Pick<Camera, 'rotation' | 'tilt'>): boolean {
  return camera.rotation === 0 && camera.tilt === 0;
}

/**
 * Screen position of a point of the map, and its depth: of two points at
 * the same screen position, the one with the larger depth is in front.
 */
export function project(
  camera: Camera,
  u: number,
  v: number,
  z = 0,
): { x: number; y: number; depth: number } {
  const { k, tx, ty } = camera;
  const c = Math.cos(camera.rotation * RAD);
  const s = Math.sin(camera.rotation * RAD);
  const ct = Math.cos(camera.tilt * RAD);
  const st = Math.sin(camera.tilt * RAD);
  const xr = u * c - v * s;
  const yr = u * s + v * c;
  return { x: k * xr + tx, y: k * (yr * ct - z * st) + ty, depth: k * (yr * st + z * ct) };
}

/** Image position of the point at height z that shows at a screen position */
export function unproject(camera: Camera, x: number, y: number, z = 0): { u: number; v: number } {
  const { k, tx, ty } = camera;
  const c = Math.cos(camera.rotation * RAD);
  const s = Math.sin(camera.rotation * RAD);
  const ct = Math.cos(camera.tilt * RAD);
  const st = Math.sin(camera.tilt * RAD);
  const xr = (x - tx) / k;
  const yr = ((y - ty) / k + z * st) / ct;
  return { u: xr * c + yr * s, v: -xr * s + yr * c };
}

/**
 * Part of the map that can show in a screen rectangle of the given size:
 * the bounding box, in image pixels, of all points with heights between
 * zMin and zMax that project into it. It may extend beyond the map.
 */
export function footprint(
  camera: Camera,
  width: number,
  height: number,
  zMin = 0,
  zMax = 0,
): { x0: number; y0: number; x1: number; y1: number } {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const z of [zMin, zMax]) {
    for (const [x, y] of [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]) {
      const p = unproject(camera, x, y, z);
      box.x0 = Math.min(box.x0, p.u);
      box.y0 = Math.min(box.y0, p.v);
      box.x1 = Math.max(box.x1, p.u);
      box.y1 = Math.max(box.y1, p.v);
    }
  }
  return box;
}

/**
 * Camera with another rotation and tilt that keeps a screen point on the
 * same point of the reference plane, e.g. the centre of the canvas while
 * orbiting. The tilt is limited to [0, MAX_TILT].
 */
export function orbit(
  camera: Camera,
  rotation: number,
  tilt: number,
  pivotX: number,
  pivotY: number,
): Camera {
  const pivot = unproject(camera, pivotX, pivotY);
  const turned = {
    ...camera,
    rotation: ((rotation % 360) + 360) % 360,
    tilt: Math.min(MAX_TILT, Math.max(0, tilt)),
    tx: 0,
    ty: 0,
  };
  const p = project(turned, pivot.u, pivot.v);
  return { ...turned, tx: pivotX - p.x, ty: pivotY - p.y };
}
