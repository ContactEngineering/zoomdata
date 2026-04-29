// happy-dom exposes canvas APIs on window but not always as bare globals in
// the test environment. Provide minimal polyfills so ColorMapper.render() can
// run — including full put/getImageData round-tripping so pixel-level tests work.

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: PredefinedColorSpace = 'srgb';

    constructor(swOrData: number | Uint8ClampedArray, sw: number, sh?: number) {
      if (typeof swOrData === 'number') {
        this.width = swOrData;
        this.height = sw;
        this.data = new Uint8ClampedArray(swOrData * sw * 4);
      } else {
        this.data = swOrData;
        this.width = sw;
        this.height = sh !== undefined ? sh : swOrData.length / (4 * sw);
      }
    }
  } as unknown as typeof ImageData;
}

if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class {
    readonly width: number;
    readonly height: number;
    private readonly _pixels: Uint8ClampedArray;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this._pixels = new Uint8ClampedArray(width * height * 4);
    }

    getContext(type: string) {
      if (type !== '2d') return null;
      const pixels = this._pixels;
      const canvasWidth = this.width;
      return {
        putImageData(imageData: ImageData, dx: number, dy: number) {
          for (let r = 0; r < imageData.height; r++) {
            for (let c = 0; c < imageData.width; c++) {
              const src = (r * imageData.width + c) * 4;
              const dst = ((dy + r) * canvasWidth + (dx + c)) * 4;
              for (let ch = 0; ch < 4; ch++) pixels[dst + ch] = imageData.data[src + ch];
            }
          }
        },
        getImageData(x: number, y: number, iw: number, ih: number): ImageData {
          const out = new globalThis.ImageData(iw, ih);
          for (let r = 0; r < ih; r++) {
            for (let c = 0; c < iw; c++) {
              const src = ((y + r) * canvasWidth + (x + c)) * 4;
              const dst = (r * iw + c) * 4;
              for (let ch = 0; ch < 4; ch++) out.data[dst + ch] = pixels[src + ch];
            }
          }
          return out;
        },
      };
    }
  } as unknown as typeof OffscreenCanvas;
}
