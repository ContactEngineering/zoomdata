/**
 * WebGL2 renderer for tiled zoomable data.
 *
 * Tiles are uploaded once as R32F textures holding their stored values and
 * sampled with texelFetch (nearest neighbour, no filtering extension
 * needed). The colour range and the palette are applied in the fragment
 * shader, so changing either does not touch the tile textures. NaN shows
 * the no-data colour.
 */
import type { PixelRect } from './PyramidGeometry';

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

const FRAGMENT_SHADER = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;

  uniform sampler2D u_data;
  uniform sampler2D u_palette;
  // t = v * u_map.x + u_map.y maps a stored value to [0, 1]
  uniform vec2 u_map;
  uniform vec4 u_noData;

  in vec2 v_texel;
  out vec4 outColor;

  bool isNaN(float v) {
    uint bits = floatBitsToUint(v);
    return (bits & 0x7f800000u) == 0x7f800000u && (bits & 0x007fffffu) != 0u;
  }

  void main() {
    ivec2 size = textureSize(u_data, 0);
    ivec2 p = clamp(ivec2(floor(v_texel)), ivec2(0), size - 1);
    float v = texelFetch(u_data, p, 0).r;
    if (isNaN(v)) {
      outColor = u_noData;
      return;
    }
    float t = clamp(v * u_map.x + u_map.y, 0.0, 1.0);
    int n = textureSize(u_palette, 0).x;
    int i = clamp(int(floor(t * float(n))), 0, n - 1);
    outColor = texelFetch(u_palette, ivec2(i, 0), 0);
  }
`;

export interface TileTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  /** Bytes held on the GPU */
  bytes: number;
}

/** View transform: screen = k * image + (tx, ty), in canvas pixels */
export interface ViewTransform {
  k: number;
  tx: number;
  ty: number;
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

  private view: ViewTransform = { k: 1, tx: 0, ty: 0 };
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
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = {};
    for (const name of [
      'u_screenRect',
      'u_texelRect',
      'u_resolution',
      'u_data',
      'u_palette',
      'u_map',
      'u_noData',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name)!;
    }

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

  setPalette(palette: number[]): void {
    this.palette = palette;
    if (!this.lost) this.uploadPalette();
  }

  /**
   * Clear the canvas and set the view transform for the following draws
   */
  beginFrame(view: ViewTransform): void {
    this.view = view;
    if (this.lost) return;
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const [r, g, b] = this.background;
    gl.clearColor(r / 255, g / 255, b / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Draw the part `placement.clip` of the image from a tile texture
   */
  drawTile(tileTexture: TileTexture, placement: TilePlacement): void {
    if (this.lost) return;
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
    gl.uniform2f(this.uniforms.u_map, placement.scale, placement.offset);
    const [r, g, b, a] = this.noData;
    gl.uniform4f(this.uniforms.u_noData, r / 255, g / 255, b / 255, a / 255);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tileTexture.texture);
    gl.uniform1i(this.uniforms.u_data, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(this.uniforms.u_palette, 1);

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
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.paletteTexture);
  }
}
