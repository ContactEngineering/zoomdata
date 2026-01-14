/**
 * WebGL-based renderer for tiled zoomable data.
 * Performs color mapping on the GPU for better performance.
 */

// Vertex shader - transforms tile quads to screen space
const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;

  uniform vec2 u_resolution;
  uniform vec2 u_translation;
  uniform vec2 u_scale;

  varying vec2 v_texCoord;

  void main() {
    // Apply scale and translation, then convert to clip space
    vec2 position = (a_position * u_scale + u_translation) / u_resolution * 2.0 - 1.0;
    // Flip Y for canvas coordinates (top-left origin)
    gl_Position = vec4(position.x, -position.y, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

// Fragment shader - samples data texture and applies color palette
const FRAGMENT_SHADER = `
  precision mediump float;

  uniform sampler2D u_dataTexture;
  uniform sampler2D u_paletteTexture;
  uniform float u_minValue;
  uniform float u_maxValue;

  varying vec2 v_texCoord;

  void main() {
    // Sample the data value
    float value = texture2D(u_dataTexture, v_texCoord).r;

    // Normalize to [0, 1] range
    float normalized = clamp((value - u_minValue) / (u_maxValue - u_minValue), 0.0, 1.0);

    // Sample the color palette
    gl_FragColor = texture2D(u_paletteTexture, vec2(normalized, 0.5));
  }
`;

export interface TileTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export class WebGLRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private positionBuffer: WebGLBuffer;
  private texCoordBuffer: WebGLBuffer;
  private paletteTexture: WebGLTexture;

  // Attribute and uniform locations
  private positionLocation: number;
  private texCoordLocation: number;
  private resolutionLocation: WebGLUniformLocation;
  private translationLocation: WebGLUniformLocation;
  private scaleLocation: WebGLUniformLocation;
  private dataTextureLocation: WebGLUniformLocation;
  private paletteTextureLocation: WebGLUniformLocation;
  private minValueLocation: WebGLUniformLocation;
  private maxValueLocation: WebGLUniformLocation;

  // Current state
  private minValue: number;
  private maxValue: number;

  constructor(canvas: HTMLCanvasElement, palette: number[], minValue: number, maxValue: number) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error('WebGL not supported');
    }

    this.gl = gl;
    this.minValue = minValue;
    this.maxValue = maxValue;

    // Compile shaders and create program
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);

    // Get attribute and uniform locations
    this.positionLocation = gl.getAttribLocation(this.program, 'a_position');
    this.texCoordLocation = gl.getAttribLocation(this.program, 'a_texCoord');
    this.resolutionLocation = gl.getUniformLocation(this.program, 'u_resolution')!;
    this.translationLocation = gl.getUniformLocation(this.program, 'u_translation')!;
    this.scaleLocation = gl.getUniformLocation(this.program, 'u_scale')!;
    this.dataTextureLocation = gl.getUniformLocation(this.program, 'u_dataTexture')!;
    this.paletteTextureLocation = gl.getUniformLocation(this.program, 'u_paletteTexture')!;
    this.minValueLocation = gl.getUniformLocation(this.program, 'u_minValue')!;
    this.maxValueLocation = gl.getUniformLocation(this.program, 'u_maxValue')!;

    // Create buffers for a unit quad
    this.positionBuffer = this.createBuffer(new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]));

    this.texCoordBuffer = this.createBuffer(new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]));

    // Create palette texture
    this.paletteTexture = this.createPaletteTexture(palette);

    // Enable blending for potential transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Compile a shader from source
   */
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

  /**
   * Create a shader program from vertex and fragment shader sources
   */
  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) {
      throw new Error('Failed to create program');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      throw new Error(`Program linking failed: ${info}`);
    }

    return program;
  }

  /**
   * Create a buffer with the given data
   */
  private createBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error('Failed to create buffer');
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    return buffer;
  }

  /**
   * Create a 1D texture from the color palette
   */
  private createPaletteTexture(palette: number[]): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create palette texture');
    }

    // Convert palette to RGBA bytes
    const rgba = new Uint8Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      rgba[i * 4 + 0] = color & 0xff;           // R
      rgba[i * 4 + 1] = (color >> 8) & 0xff;    // G
      rgba[i * 4 + 2] = (color >> 16) & 0xff;   // B
      rgba[i * 4 + 3] = (color >> 24) & 0xff;   // A
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, palette.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
  }

  /**
   * Create a texture from raw tile data (float array)
   */
  createTileTexture(data: Float32Array, width: number, height: number): TileTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create tile texture');
    }

    console.log(`createTileTexture: input width=${width}, height=${height}, data.length=${data.length}`);

    // Validate dimensions match data length
    const expectedSize = width * height;
    if (data.length !== expectedSize) {
      console.error(`Tile data length (${data.length}) doesn't match dimensions (${width}x${height}=${expectedSize})`);
      // Adjust dimensions to match actual data if possible
      if (data.length > 0) {
        // Try to infer square dimensions, or use data length as width with height=1
        const sqrtLen = Math.sqrt(data.length);
        if (Number.isInteger(sqrtLen)) {
          width = sqrtLen;
          height = sqrtLen;
          console.log(`  Adjusted to square: ${width}x${height}`);
        } else {
          width = data.length;
          height = 1;
          console.log(`  Adjusted to 1D: ${width}x${height}`);
        }
      }
    }

    console.log(`  Final texture dimensions: ${width}x${height}, luminance.length will be ${data.length}`);
    console.log(`  Normalization range: minValue=${this.minValue}, maxValue=${this.maxValue}`);

    // Debug: check actual data range
    let dataMin = Infinity, dataMax = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < dataMin) dataMin = data[i];
      if (data[i] > dataMax) dataMax = data[i];
    }
    console.log(`  Actual data range: [${dataMin}, ${dataMax}]`);

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // WebGL 1.0 doesn't support float textures directly without extensions
    // Convert to luminance (8-bit) with normalized values for now
    // For better precision, we could use OES_texture_float extension
    const luminance = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      // Normalize to 0-255 range based on min/max
      const normalized = (data[i] - this.minValue) / (this.maxValue - this.minValue);
      luminance[i] = Math.max(0, Math.min(255, Math.round(normalized * 255)));
    }

    // Debug: check luminance range
    let lumMin = 255, lumMax = 0;
    for (let i = 0; i < luminance.length; i++) {
      if (luminance[i] < lumMin) lumMin = luminance[i];
      if (luminance[i] > lumMax) lumMax = luminance[i];
    }
    console.log(`  Luminance range: [${lumMin}, ${lumMax}]`);

    // Set pixel store alignment to 1 byte (default is 4) to handle non-power-of-2 textures
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, luminance);

    // Check for WebGL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error(`WebGL error after texImage2D: ${error}, width=${width}, height=${height}, luminance.length=${luminance.length}`);
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return { texture, width, height };
  }

  /**
   * Delete a tile texture
   */
  deleteTileTexture(tileTexture: TileTexture): void {
    this.gl.deleteTexture(tileTexture.texture);
  }

  /**
   * Update the color palette
   */
  setPalette(palette: number[]): void {
    const gl = this.gl;

    // Convert palette to RGBA bytes
    const rgba = new Uint8Array(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      rgba[i * 4 + 0] = color & 0xff;
      rgba[i * 4 + 1] = (color >> 8) & 0xff;
      rgba[i * 4 + 2] = (color >> 16) & 0xff;
      rgba[i * 4 + 3] = (color >> 24) & 0xff;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, palette.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  /**
   * Update the value range for color mapping
   */
  setValueRange(minValue: number, maxValue: number): void {
    this.minValue = minValue;
    this.maxValue = maxValue;
  }

  /**
   * Clear the canvas
   */
  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.95, 0.95, 0.95, 1.0); // Light gray background
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Render a tile at the specified position and size
   */
  renderTile(
    tileTexture: TileTexture,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    this.renderTileRegion(tileTexture, x, y, width, height, 0, 0, 1, 1);
  }

  /**
   * Render a region of a tile texture at the specified position and size
   * @param tileTexture - The tile texture to render
   * @param x - Screen X position
   * @param y - Screen Y position
   * @param width - Screen width
   * @param height - Screen height
   * @param texX - Texture X coordinate (0-1)
   * @param texY - Texture Y coordinate (0-1)
   * @param texW - Texture width (0-1)
   * @param texH - Texture height (0-1)
   */
  renderTileRegion(
    tileTexture: TileTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    texX: number,
    texY: number,
    texW: number,
    texH: number
  ): void {
    const gl = this.gl;

    gl.useProgram(this.program);

    // Set resolution uniform
    gl.uniform2f(this.resolutionLocation, gl.canvas.width, gl.canvas.height);

    // Set translation and scale for this tile
    gl.uniform2f(this.translationLocation, x, y);
    gl.uniform2f(this.scaleLocation, width, height);

    // Set value range for color mapping
    // Note: For 8-bit luminance texture, the shader sees values in [0,1] already normalized
    gl.uniform1f(this.minValueLocation, 0.0);
    gl.uniform1f(this.maxValueLocation, 1.0);

    // Bind position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Create custom texture coordinates for the region
    const texRight = texX + texW;
    const texBottom = texY + texH;
    const texCoords = new Float32Array([
      texX, texY,
      texRight, texY,
      texX, texBottom,
      texX, texBottom,
      texRight, texY,
      texRight, texBottom,
    ]);

    // Update texture coordinate buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.texCoordLocation);
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    // Bind data texture to unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tileTexture.texture);
    gl.uniform1i(this.dataTextureLocation, 0);

    // Bind palette texture to unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(this.paletteTextureLocation, 1);

    // Draw the quad
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Clean up WebGL resources
   */
  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.texCoordBuffer);
    gl.deleteTexture(this.paletteTexture);
  }
}
