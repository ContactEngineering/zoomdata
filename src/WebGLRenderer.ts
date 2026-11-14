/**
 * WebGL2 renderer for tiled zoomable data.
 *
 * Tiles are uploaded once as R32F textures holding their stored values and
 * sampled with texelFetch (nearest neighbour, no filtering extension
 * needed). The colour range and the palette are applied in the fragment
 * shader, so changing either does not touch the tile textures. NaN shows
 * the no-data colour.
 *
 * The plain view draws one quad per tile. The tilted or rotated view draws
 * the same textures on a mesh whose heights the vertex shader reads from
 * them, with an orthographic camera (see camera.ts).
 */
import { isPlain, unproject, type Camera } from './camera.js';
import type { PixelRect } from './PyramidGeometry.js';
import { lightVector, type ReliefOptions } from './relief.js';

const VERTEX_SHADER = `#version 300 es
  in vec2 a_unit;

  // Quad in screen pixels and the matching tile texel coordinates
  uniform vec4 u_screenRect;
  uniform vec4 u_texelRect;
  uniform vec2 u_resolution;

  out vec2 v_texel;

  void main() {
    vec2 screen = mix(u_screenRect.xy, u_screenRect.zw, a_unit);
    vec2 clip = screen / u_resolution * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_texel = mix(u_texelRect.xy, u_texelRect.zw, a_unit);
  }
`;

// Surface mesh for the tilted or rotated view. The surface has a vertex at
// the centre of every level pixel, at the height of its value, and is flat
// from the outermost centres to the border of the map; the squares between
// four centres are split along the same diagonal everywhere. Each point has
// the colour of the level pixel it lies in, as in the plain view.
//
// A tile draws the part of this surface over its own pixels. Its mesh
// reaches to the pixel centres just outside them, which it holds if tiles
// overlap by a pixel, and the fragment shader trims it at the border of the
// part, so tiles meet without gaps.
const SURFACE_VERTEX_SHADER = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;

  // Integer position of the vertex in the mesh
  in vec2 a_grid;

  uniform sampler2D u_data;
  // Extent of the mesh in level pixels (x0, y0, x1, y1), and the texel
  // centre at its corner, before it was limited to the map
  uniform vec4 u_region;
  uniform vec2 u_first;
  // Level pixel of the texture's first texel
  uniform vec2 u_origin;
  // Image position of the region's corner relative to the pivot, and the
  // size of a level pixel, in image pixels
  uniform vec2 u_offset;
  uniform float u_stride;
  // Height above the reference plane in image pixels: z = v * x + y
  uniform vec2 u_height;
  // cos and sin of the rotation, cos and sin of the tilt
  uniform vec4 u_turn;
  // Scale, and the screen position of the pivot
  uniform vec3 u_screen;
  // Size of the canvas, and the largest depth
  uniform vec3 u_clip;

  out vec2 v_texel;

  bool isNaN(float v) {
    uint bits = floatBitsToUint(v);
    return (bits & 0x7f800000u) == 0x7f800000u && (bits & 0x007fffffu) != 0u;
  }

  // Stored value at a position of the texture, interpolated between the
  // centres of the texels; undefined values are left out. y is 0 if all
  // four are undefined.
  vec2 value(vec2 c) {
    ivec2 size = textureSize(u_data, 0);
    vec2 f = c - 0.5;
    vec2 base = floor(f);
    vec2 w = f - base;
    float sum = 0.0;
    float weight = 0.0;
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        ivec2 p = clamp(ivec2(base) + ivec2(i, j), ivec2(0), size - 1);
        float v = texelFetch(u_data, p, 0).r;
        float wt = (i == 0 ? 1.0 - w.x : w.x) * (j == 0 ? 1.0 - w.y : w.y);
        if (!isNaN(v)) {
          sum += wt * v;
          weight += wt;
        }
      }
    }
    return weight > 0.0 ? vec2(sum / weight, 1.0) : vec2(0.0);
  }

  void main() {
    vec2 q = clamp(u_first + a_grid, u_region.xy, u_region.zw);
    vec2 v = value(q - u_origin);
    // Where nothing is defined the surface lies in the reference plane
    float z = v.y > 0.0 ? v.x * u_height.x + u_height.y : 0.0;

    vec2 p = u_offset + (q - u_region.xy) * u_stride;
    float xr = p.x * u_turn.x - p.y * u_turn.y;
    float yr = p.x * u_turn.y + p.y * u_turn.x;
    vec2 screen = u_screen.x * vec2(xr, yr * u_turn.z - z * u_turn.w) + u_screen.yz;
    float depth = u_screen.x * (yr * u_turn.w + z * u_turn.z);

    vec2 clip = screen / u_clip.xy * 2.0 - 1.0;
    // Larger depths are in front
    gl_Position = vec4(clip.x, -clip.y, -depth / u_clip.z, 1.0);
    v_texel = q - u_origin;
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;

  uniform sampler2D u_data;
  uniform sampler2D u_palette;
  // t = v * u_map.x + u_map.y maps a stored value to [0, 1]
  uniform vec2 u_map;
  uniform vec4 u_noData;
  // Part of the texture to draw (x0, y0, x1, y1); the rest is trimmed
  uniform vec4 u_keep;
  // Relief shading. u_slope: slope of the surface per difference of the
  // stored values of neighbouring texels, along x and y. u_light: unit
  // vector towards the light. u_shade: ambient share and 1 / sin(altitude);
  // the latter is 0 if relief is off.
  uniform vec2 u_slope;
  uniform vec3 u_light;
  uniform vec2 u_shade;

  in vec2 v_texel;
  out vec4 outColor;

  bool isNaN(float v) {
    uint bits = floatBitsToUint(v);
    return (bits & 0x7f800000u) == 0x7f800000u && (bits & 0x007fffffu) != 0u;
  }

  // Central difference of the stored values across texel p along d, per
  // texel. Falls back to a one-sided difference at the edge of the texture
  // and next to undefined values.
  float difference(ivec2 p, ivec2 d, ivec2 size, float v) {
    ivec2 a = clamp(p - d, ivec2(0), size - 1);
    ivec2 b = clamp(p + d, ivec2(0), size - 1);
    float va = texelFetch(u_data, a, 0).r;
    float vb = texelFetch(u_data, b, 0).r;
    if (isNaN(va)) {
      a = p;
      va = v;
    }
    if (isNaN(vb)) {
      b = p;
      vb = v;
    }
    int n = (b.x - a.x) + (b.y - a.y);
    return n > 0 ? (vb - va) / float(n) : 0.0;
  }

  void main() {
    if (any(lessThan(v_texel, u_keep.xy)) || any(greaterThanEqual(v_texel, u_keep.zw))) discard;
    ivec2 size = textureSize(u_data, 0);
    // A texel of the part to draw, also in the sliver that the trimming
    // leaves beyond it; the part may end within a texel
    vec2 texel = clamp(v_texel, floor(u_keep.xy + 0.01), ceil(u_keep.zw - 0.01) - 0.5);
    ivec2 p = clamp(ivec2(floor(texel)), ivec2(0), size - 1);
    float v = texelFetch(u_data, p, 0).r;
    if (isNaN(v)) {
      // A transparent no-data colour shows what is behind
      if (u_noData.a == 0.0) discard;
      outColor = u_noData;
      return;
    }
    float t = clamp(v * u_map.x + u_map.y, 0.0, 1.0);
    int n = textureSize(u_palette, 0).x;
    int i = clamp(int(floor(t * float(n))), 0, n - 1);
    outColor = texelFetch(u_palette, ivec2(i, 0), 0);

    if (u_shade.y > 0.0) {
      vec2 g = u_slope * vec2(
        difference(p, ivec2(1, 0), size, v),
        difference(p, ivec2(0, 1), size, v)
      );
      // Normal of the surface z = h(x, y)
      vec3 normal = normalize(vec3(-g, 1.0));
      float diffuse = max(dot(normal, u_light), 0.0) * u_shade.y;
      outColor.rgb *= u_shade.x + (1.0 - u_shade.x) * diffuse;
    }
  }
`;

export interface TileTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  /** Bytes held on the GPU */
  bytes: number;
}

/**
 * View transform in canvas pixels: screen = k * image + (tx, ty), turned by
 * `rotation` and tipped back by `tilt` (degrees, default 0; see camera.ts)
 */
export interface ViewTransform {
  k: number;
  tx: number;
  ty: number;
  rotation?: number;
  tilt?: number;
}

/** Where a tile texture sits in the image */
export interface TilePlacement {
  /** Image pixels per texel (the level's stride) */
  stride: number;
  /** Level pixel of the texture's first texel */
  originX: number;
  originY: number;
  /** Part of the image to draw, in image pixels */
  clip: PixelRect;
  /** Maps stored values to [0, 1]: t = v * scale + offset */
  scale: number;
  offset: number;
  /**
   * Slope of the surface per difference of the stored values of
   * neighbouring texels, along x and y; used for relief shading
   */
  slopeX: number;
  slopeY: number;
  /**
   * Height of the surface above the reference plane, in image pixels:
   * z = v * heightScale + heightOffset; used in the tilted view
   */
  heightScale: number;
  heightOffset: number;
}

/** Whether the browser can run the renderer */
export function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** Split a 32-bit ABGR colour (palette convention) into RGBA bytes */
function unpackColor(color: number): [number, number, number, number] {
  return [color & 0xff, (color >>> 8) & 0xff, (color >>> 16) & 0xff, (color >>> 24) & 0xff];
}

export interface RendererColors {
  /** 32-bit ABGR colour of undefined points (default: transparent) */
  noData?: number;
  /** 32-bit ABGR colour behind the image (default: light grey) */
  background?: number;
}

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private palette: number[];
  private noData: [number, number, number, number];
  private background: [number, number, number, number];

  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private buffer!: WebGLBuffer;
  private paletteTexture!: WebGLTexture;
  private uniforms!: Record<string, WebGLUniformLocation>;

  // Tilted or rotated view: program, and a mesh of `gridSize` vertices a side
  private surfaceProgram!: WebGLProgram;
  private surfaceUniforms!: Record<string, WebGLUniformLocation>;
  private grid: { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; size: number } | null = null;

  private view: Camera = { k: 1, tx: 0, ty: 0, rotation: 0, tilt: 0 };
  // Largest depth of the frame, for the depth buffer
  private depthRange = 1;
  private imageSize = { width: 1, height: 1 };
  private relief: Required<ReliefOptions> | null = null;
  private lost = false;

  /** Called after the context was restored; textures must be re-created */
  onContextRestored: (() => void) | null = null;

  private readonly handleLost = (event: Event) => {
    // Allow the context to be restored
    event.preventDefault();
    this.lost = true;
  };

  private readonly handleRestored = () => {
    this.lost = false;
    this.initResources();
    this.onContextRestored?.();
  };

  constructor(canvas: HTMLCanvasElement, palette: number[], colors: RendererColors = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.canvas = canvas;
    this.gl = gl;
    this.palette = palette;
    this.noData = unpackColor(colors.noData ?? 0);
    this.background = unpackColor(colors.background ?? 0xfff2f2f2);
    this.initResources();
    canvas.addEventListener('webglcontextlost', this.handleLost);
    canvas.addEventListener('webglcontextrestored', this.handleRestored);
  }

  private initResources(): void {
    const gl = this.gl;
    const shared = [
      'u_data',
      'u_palette',
      'u_map',
      'u_noData',
      'u_keep',
      'u_slope',
      'u_light',
      'u_shade',
    ];
    const locate = (program: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)!]));
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = locate(this.program, [
      'u_screenRect',
      'u_texelRect',
      'u_resolution',
      ...shared,
    ]);
    this.surfaceProgram = this.createProgram(SURFACE_VERTEX_SHADER, FRAGMENT_SHADER);
    this.surfaceUniforms = locate(this.surfaceProgram, [
      'u_region',
      'u_first',
      'u_origin',
      'u_offset',
      'u_stride',
      'u_height',
      'u_turn',
      'u_screen',
      'u_clip',
      ...shared,
    ]);
    // Built when the tilted view first needs it
    this.grid = null;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(this.program, 'a_unit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.paletteTexture = gl.createTexture()!;
    this.uploadPalette();

    // Undefined points may be transparent and show the background
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${info}`);
    }
    return shader;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) {
      throw new Error('Failed to create program');
    }
    gl.attachShader(program, this.compileShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, this.compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program linking failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  private uploadPalette(): void {
    const gl = this.gl;
    const rgba = new Uint8Array(this.palette.length * 4);
    this.palette.forEach((color, i) => rgba.set(unpackColor(color), 4 * i));
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.palette.length,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /**
   * Upload tile values (row-major, width x height) as an R32F texture
   */
  createTileTexture(data: Float32Array, width: number, height: number): TileTexture {
    if (data.length !== width * height) {
      throw new Error(`Tile data length ${data.length} does not match ${width} x ${height}`);
    }
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create tile texture');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, width, height, bytes: 4 * width * height };
  }

  deleteTileTexture(tileTexture: TileTexture): void {
    if (!this.lost) this.gl.deleteTexture(tileTexture.texture);
  }

  /**
   * Light the map from one direction (null: off). Applied in the shader;
   * tile textures stay as they are.
   */
  setRelief(relief: Required<ReliefOptions> | null): void {
    this.relief = relief;
  }

  setPalette(palette: number[]): void {
    this.palette = palette;
    if (!this.lost) this.uploadPalette();
  }

  /**
   * Clear the canvas and set the view transform for the following draws
   * @param imageSize - For the tilted view: the size of the map in image pixels
   * @param extent - For the tilted view: the largest distance between two
   *   points of the surface, in image pixels
   */
  beginFrame(view: ViewTransform, imageSize = { width: 1, height: 1 }, extent = 1): void {
    this.view = { rotation: 0, tilt: 0, ...view };
    this.imageSize = imageSize;
    this.depthRange = view.k * extent + 1;
    if (this.lost) return;
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const [r, g, b] = this.background;
    gl.clearColor(r / 255, g / 255, b / 255, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // In the tilted view, parts of the surface hide others
    if (isPlain(this.view)) gl.disable(gl.DEPTH_TEST);
    else gl.enable(gl.DEPTH_TEST);
  }

  /** Mesh of n x n vertices, as triangles row by row */
  private surfaceGrid(n: number): NonNullable<WebGLRenderer['grid']> {
    if (this.grid && this.grid.size >= n) return this.grid;
    const gl = this.gl;
    if (this.grid) {
      gl.deleteVertexArray(this.grid.vao);
      this.grid.buffers.forEach((b) => gl.deleteBuffer(b));
    }
    const vertices = new Float32Array(2 * n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) vertices.set([i, j], 2 * (j * n + i));
    }
    const indices = new Uint32Array(6 * (n - 1) * (n - 1));
    let o = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        indices.set([a, a + 1, a + n, a + n, a + 1, a + n + 1], o);
        o += 6;
      }
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.surfaceProgram, 'a_grid');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.grid = { vao, buffers: [vertexBuffer, indexBuffer], size: n };
    return this.grid;
  }

  /** Uniforms and textures both programs share */
  private bindShared(
    uniforms: Record<string, WebGLUniformLocation>,
    tileTexture: TileTexture,
    placement: TilePlacement,
  ): void {
    const gl = this.gl;
    gl.uniform2f(uniforms.u_map, placement.scale, placement.offset);
    const relief = this.relief;
    if (relief) {
      const e = relief.exaggeration;
      gl.uniform2f(uniforms.u_slope, e * placement.slopeX, e * placement.slopeY);
      const light = lightVector(relief.azimuth, relief.altitude);
      gl.uniform3f(uniforms.u_light, ...light);
      gl.uniform2f(uniforms.u_shade, relief.ambient, 1 / light[2]);
    } else {
      gl.uniform2f(uniforms.u_shade, 0, 0);
    }
    const [r, g, b, a] = this.noData;
    gl.uniform4f(uniforms.u_noData, r / 255, g / 255, b / 255, a / 255);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tileTexture.texture);
    gl.uniform1i(uniforms.u_data, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(uniforms.u_palette, 1);
  }

  /** Draw a part of the image as a surface, for the tilted or rotated view */
  private drawSurface(tileTexture: TileTexture, placement: TilePlacement): void {
    const gl = this.gl;
    const view = this.view;
    const { stride, clip } = placement;
    // Part to draw, in level pixels
    const keep = {
      x0: clip.x0 / stride,
      y0: clip.y0 / stride,
      x1: clip.x1 / stride,
      y1: clip.y1 / stride,
    };
    // Vertices at the pixel centres, from the one at or before the corner
    // of the part to the one at or after its far corner, but not beyond the
    // border of the map, where the surface ends
    const firstX = Math.floor(keep.x0 - 0.5) + 0.5;
    const firstY = Math.floor(keep.y0 - 0.5) + 0.5;
    const lastX = Math.ceil(keep.x1 - 0.5) + 0.5;
    const lastY = Math.ceil(keep.y1 - 0.5) + 0.5;
    const region = {
      x0: Math.max(firstX, 0),
      y0: Math.max(firstY, 0),
      x1: Math.min(lastX, this.imageSize.width / stride),
      y1: Math.min(lastY, this.imageSize.height / stride),
    };
    const columns = lastX - firstX + 1;
    const rows = lastY - firstY + 1;
    const grid = this.surfaceGrid(Math.max(columns, rows));

    // Positions relative to the image point at the centre of the canvas,
    // in double precision, so that float32 suffices in the shader
    const { width, height } = this.canvas;
    const pivot = unproject(view, width / 2, height / 2);
    const rotation = (view.rotation * Math.PI) / 180;
    const tilt = (view.tilt * Math.PI) / 180;

    const u = this.surfaceUniforms;
    gl.useProgram(this.surfaceProgram);
    gl.bindVertexArray(grid.vao);
    gl.uniform4f(u.u_region, region.x0, region.y0, region.x1, region.y1);
    gl.uniform2f(u.u_first, firstX, firstY);
    gl.uniform2f(u.u_origin, placement.originX, placement.originY);
    gl.uniform2f(u.u_offset, region.x0 * stride - pivot.u, region.y0 * stride - pivot.v);
    // Trim to the part, generously: a hair's breadth drawn twice does not
    // show, a hair's breadth not drawn would
    const e = 1e-3;
    gl.uniform4f(
      u.u_keep,
      keep.x0 - placement.originX - e,
      keep.y0 - placement.originY - e,
      keep.x1 - placement.originX + e,
      keep.y1 - placement.originY + e,
    );
    gl.uniform1f(u.u_stride, stride);
    gl.uniform2f(u.u_height, placement.heightScale, placement.heightOffset);
    gl.uniform4f(u.u_turn, Math.cos(rotation), Math.sin(rotation), Math.cos(tilt), Math.sin(tilt));
    gl.uniform3f(u.u_screen, view.k, width / 2, height / 2);
    gl.uniform3f(u.u_clip, width, height, this.depthRange);
    this.bindShared(u, tileTexture, placement);

    // Rows of the mesh beyond the region are empty
    gl.drawElements(gl.TRIANGLES, 6 * (grid.size - 1) * (rows - 1), gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Draw the part `placement.clip` of the image from a tile texture
   */
  drawTile(tileTexture: TileTexture, placement: TilePlacement): void {
    if (this.lost) return;
    if (!isPlain(this.view)) {
      this.drawSurface(tileTexture, placement);
      return;
    }
    const gl = this.gl;
    const { k, tx, ty } = this.view;
    const { stride, originX, originY, clip } = placement;

    // Clip to the canvas (with a margin) in double precision, so large
    // images at high magnification do not lose float32 precision
    const margin = 1;
    const x0 = Math.max(clip.x0, (-margin - tx) / k);
    const y0 = Math.max(clip.y0, (-margin - ty) / k);
    const x1 = Math.min(clip.x1, (this.canvas.width + margin - tx) / k);
    const y1 = Math.min(clip.y1, (this.canvas.height + margin - ty) / k);
    if (x1 <= x0 || y1 <= y0) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
    gl.uniform4f(this.uniforms.u_screenRect, k * x0 + tx, k * y0 + ty, k * x1 + tx, k * y1 + ty);
    gl.uniform4f(
      this.uniforms.u_texelRect,
      x0 / stride - originX,
      y0 / stride - originY,
      x1 / stride - originX,
      y1 / stride - originY,
    );
    this.bindShared(this.uniforms, tileTexture, placement);
    // The quad is the part to draw
    gl.uniform4f(this.uniforms.u_keep, -1e9, -1e9, 1e9, 1e9);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /**
   * Clean up WebGL resources
   */
  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    if (this.lost) return;
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.surfaceProgram);
    if (this.grid) {
      gl.deleteVertexArray(this.grid.vao);
      this.grid.buffers.forEach((b) => gl.deleteBuffer(b));
    }
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.paletteTexture);
  }
}
