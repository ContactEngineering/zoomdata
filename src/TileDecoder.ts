/**
 * Decoder for NetCDF-3 pyramid tiles (see docs/pyramid-format.md).
 *
 * Tiles have a fixed layout: a two-dimensional variable `heights` over the
 * dimensions `x` and `y`, plus optional coordinate variables `x` and `y`.
 * The decoder reads the header (classic and 64-bit offset variants), rejects
 * anything else, and converts the big-endian float32 or float64 data to a
 * row-major (y, x) Float32Array in one pass. It is pure, so it can run in a
 * worker.
 */

/** Linear encoding of stored values: h = addOffset + scaleFactor * v */
export interface ValueEncoding {
  scaleFactor: number;
  addOffset: number;
}

export interface DecodedTile {
  width: number;
  height: number;
  /**
   * Stored values v, row-major (y, x), NaN where undefined. Physical values
   * are `addOffset + scaleFactor * v`; keeping v (in [0, 1] or [-0.5, 0.5])
   * spends the float32 mantissa on the data's range.
   */
  values: Float32Array;
  /** CF attributes of `heights`, if present */
  encoding: ValueEncoding | null;
  /** Unit of the heights (attribute `unit`), if present */
  unit: string | null;
  /** Coordinates of the tile's pixels, if present */
  x: Float64Array | null;
  y: Float64Array | null;
}

export class TileDecodeError extends Error {
  constructor(message: string) {
    super(`Invalid tile: ${message}`);
    this.name = 'TileDecodeError';
  }
}

const NC_DIMENSION = 0x0a;
const NC_VARIABLE = 0x0b;
const NC_ATTRIBUTE = 0x0c;

const NC_BYTE = 1;
const NC_CHAR = 2;
const NC_SHORT = 3;
const NC_INT = 4;
const NC_FLOAT = 5;
const NC_DOUBLE = 6;

const TYPE_SIZE: Record<number, number> = {
  [NC_BYTE]: 1,
  [NC_CHAR]: 1,
  [NC_SHORT]: 2,
  [NC_INT]: 4,
  [NC_FLOAT]: 4,
  [NC_DOUBLE]: 8,
};

type AttributeValue = string | number[];

interface Variable {
  name: string;
  dims: number[];
  attributes: Map<string, AttributeValue>;
  type: number;
  begin: number;
}

class Reader {
  private pos = 0;
  constructor(private readonly view: DataView) {}

  private need(n: number): void {
    if (this.pos + n > this.view.byteLength) {
      throw new TileDecodeError('truncated header');
    }
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  u64(): number {
    this.need(8);
    const hi = this.view.getUint32(this.pos);
    const lo = this.view.getUint32(this.pos + 4);
    this.pos += 8;
    return hi * 2 ** 32 + lo;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const b = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n + ((4 - (n % 4)) % 4);
    return b;
  }

  name(): string {
    return new TextDecoder().decode(this.bytes(this.u32()));
  }

  values(type: number, n: number): AttributeValue {
    const size = TYPE_SIZE[type];
    if (size === undefined) throw new TileDecodeError(`unknown type ${type}`);
    this.need(n * size);
    if (type === NC_CHAR) return new TextDecoder().decode(this.bytes(n)).replace(/\0+$/, '');
    const start = this.pos;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = start + i * size;
      switch (type) {
        case NC_BYTE:
          out.push(this.view.getInt8(p));
          break;
        case NC_SHORT:
          out.push(this.view.getInt16(p));
          break;
        case NC_INT:
          out.push(this.view.getInt32(p));
          break;
        case NC_FLOAT:
          out.push(this.view.getFloat32(p));
          break;
        default:
          out.push(this.view.getFloat64(p));
      }
    }
    this.pos = start + n * size + ((4 - ((n * size) % 4)) % 4);
    return out;
  }

  /** Tag and count of a list; an absent list is ZERO ZERO */
  list(tag: number): number {
    const t = this.u32();
    const n = this.u32();
    if (t === 0 && n === 0) return 0;
    if (t !== tag) throw new TileDecodeError(`unexpected list tag ${t}`);
    return n;
  }

  attributes(): Map<string, AttributeValue> {
    const attrs = new Map<string, AttributeValue>();
    const n = this.list(NC_ATTRIBUTE);
    for (let i = 0; i < n; i++) {
      const name = this.name();
      const type = this.u32();
      attrs.set(name, this.values(type, this.u32()));
    }
    return attrs;
  }
}

function numberAttribute(attrs: Map<string, AttributeValue>, name: string): number | null {
  const v = attrs.get(name);
  if (v === undefined) return null;
  if (typeof v === 'string' || v.length !== 1) {
    throw new TileDecodeError(`attribute ${name} is not a number`);
  }
  return v[0];
}

function readCoordinates(
  view: DataView,
  v: Variable,
  dims: { name: string; size: number }[],
  n: number,
): Float64Array {
  if (v.dims.length !== 1 || dims[v.dims[0]].name !== v.name || dims[v.dims[0]].size !== n) {
    throw new TileDecodeError(`coordinate variable ${v.name} does not match its dimension`);
  }
  const size = TYPE_SIZE[v.type];
  if (v.type !== NC_FLOAT && v.type !== NC_DOUBLE) {
    throw new TileDecodeError(`variable ${v.name} is not floating point`);
  }
  if (v.begin + n * size > view.byteLength) throw new TileDecodeError('truncated data');
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] =
      v.type === NC_DOUBLE ? view.getFloat64(v.begin + 8 * i) : view.getFloat32(v.begin + 4 * i);
  }
  return out;
}

/**
 * Decode a tile.
 * @param buffer - Contents of the NetCDF file
 * @param expected - Expected width and height of the tile, if known
 */
export function decodeTile(
  buffer: ArrayBuffer,
  expected?: { width: number; height: number },
): DecodedTile {
  const view = new DataView(buffer);
  const r = new Reader(view);

  if (view.byteLength < 4) throw new TileDecodeError('truncated header');
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 3));
  const version = view.getUint8(3);
  if (magic !== 'CDF') throw new TileDecodeError('not a NetCDF-3 file');
  if (version !== 1 && version !== 2) {
    throw new TileDecodeError(`unsupported NetCDF variant ${version}`);
  }
  r.u32();
  r.u32(); // number of records; tiles have no record variables

  const dims: { name: string; size: number }[] = [];
  const nDims = r.list(NC_DIMENSION);
  for (let i = 0; i < nDims; i++) {
    const name = r.name();
    const size = r.u32();
    if (size === 0) throw new TileDecodeError(`record dimension ${name}`);
    dims.push({ name, size });
  }
  r.attributes(); // global attributes

  const vars = new Map<string, Variable>();
  const nVars = r.list(NC_VARIABLE);
  for (let i = 0; i < nVars; i++) {
    const name = r.name();
    const nd = r.u32();
    const varDims: number[] = [];
    for (let j = 0; j < nd; j++) {
      const d = r.u32();
      if (d >= dims.length) throw new TileDecodeError(`variable ${name} has unknown dimension`);
      varDims.push(d);
    }
    const attributes = r.attributes();
    const type = r.u32();
    r.u32(); // vsize
    const begin = version === 1 ? r.u32() : r.u64();
    vars.set(name, { name, dims: varDims, attributes, type, begin });
  }

  const heights = vars.get('heights');
  if (!heights) throw new TileDecodeError('missing variable "heights"');
  if (heights.dims.length !== 2) {
    throw new TileDecodeError(`"heights" has ${heights.dims.length} dimensions, expected 2`);
  }
  const [d0, d1] = heights.dims.map((d) => dims[d]);
  let xFirst: boolean;
  if (d0.name === 'x' && d1.name === 'y') xFirst = true;
  else if (d0.name === 'y' && d1.name === 'x') xFirst = false;
  else throw new TileDecodeError(`"heights" has dimensions (${d0.name}, ${d1.name})`);
  const width = xFirst ? d0.size : d1.size;
  const height = xFirst ? d1.size : d0.size;
  if (expected && (expected.width !== width || expected.height !== height)) {
    throw new TileDecodeError(
      `shape ${width} x ${height}, expected ${expected.width} x ${expected.height}`,
    );
  }

  if (heights.type !== NC_FLOAT && heights.type !== NC_DOUBLE) {
    throw new TileDecodeError('"heights" is not float32 or float64');
  }
  const size = TYPE_SIZE[heights.type];
  const n = width * height;
  if (heights.begin + n * size > view.byteLength) throw new TileDecodeError('truncated data');

  // Transpose (x, y) storage to row-major (y, x) while converting
  const values = new Float32Array(n);
  const base = heights.begin;
  const double = heights.type === NC_DOUBLE;
  for (let k = 0; k < n; k++) {
    const p = base + k * size;
    const v = double ? view.getFloat64(p) : view.getFloat32(p);
    if (xFirst) {
      const xi = Math.floor(k / height);
      values[(k - xi * height) * width + xi] = v;
    } else {
      values[k] = v;
    }
  }

  const scaleFactor = numberAttribute(heights.attributes, 'scale_factor');
  const addOffset = numberAttribute(heights.attributes, 'add_offset');
  const encoding =
    scaleFactor === null && addOffset === null
      ? null
      : { scaleFactor: scaleFactor ?? 1, addOffset: addOffset ?? 0 };

  const unit = heights.attributes.get('unit');

  const xVar = vars.get('x');
  const yVar = vars.get('y');
  return {
    width,
    height,
    values,
    encoding,
    unit: typeof unit === 'string' && unit !== '' ? unit : null,
    x: xVar ? readCoordinates(view, xVar, dims, width) : null,
    y: yVar ? readCoordinates(view, yVar, dims, height) : null,
  };
}
