# zoomdata

TypeScript library for zoomable visualization of two-dimensional scientific data maps, similar to deep zoom image formats but designed for NetCDF data.

## Installation

```bash
npm install zoomdata
```

## Quick Start

```typescript
import { ZoomData, Palettes } from 'zoomdata';

const viewer = new ZoomData({
  rootUrl: 'http://localhost:8000/data/',
  colorPalette: Palettes.inferno(256),
});

await viewer.start('canvasId');
```

`rootUrl` is a shortcut for `source: new StaticTileSource(rootUrl)`. To serve
tiles from elsewhere, e.g. with a presigned URL per tile, implement the
`TileSource` interface:

```typescript
const source: TileSource = {
  descriptor: () => fetch(descriptorUrl).then((r) => r.json()),
  tileUrl: (level, col, row) => api.signedTileUrl(level, col, row),
};
const viewer = new ZoomData({ source });
```

The viewer needs WebGL2; check with `supportsWebGL2()` to fall back.

## Development

### Prerequisites

- Node.js 22.12 or later
- Python 3 with SurfaceTopography (for the demo data)

### Setup

```bash
# Install dependencies
npm install
```

### Running the Demo

The demo is a [Vue](https://vuejs.org/) application in `demo/`. Its data is
not part of the repository; create it once with SurfaceTopography (v1.28.0
or later):

```bash
pip install SurfaceTopography
npm run demo:data          # python demo/make_demo_data.py
npm run dev
```

The demo surface is an egg box with roughness on top: the overview shows
only the egg box, and the roughness appears when zooming in, because coarse
levels hold block averages and the colour scale follows the values in view.
`python demo/make_demo_data.py --help` lists the parameters of the surface;
datasets written with another `--name` are added to the demo's menu. The
data goes to `demo/data/`, which git ignores and the dev server serves at
`/data/`. Any other pyramid can be shown with `?data=<root URL>`.

`demo/src/components/HeightMapViewer.vue` shows how to embed the engine in
a component: it creates a `ZoomEngine` on a canvas, adds the
`DefaultController` and `CrossSections`, and reports values through events.

### Tests

```bash
# Unit tests (happy-dom)
npm test

# Render tests: render the fixture pyramids in headless Chromium and compare
# every pixel with an image computed from reference data
npx playwright install chromium   # once
npm run test:render

# Both, with coverage of the library; the HTML report is in coverage/
npm run test:coverage
```

On a mismatch, the render tests write the actual, expected and diff images
to `test/render/__output__/`. The rules for the expected image are documented
in `test/render/harness.ts`.

The fixtures in `test/fixtures/` are tile pyramids written by
SurfaceTopography, together with reference data computed independently of
the writer. Regenerate them with `python test/fixtures/generate.py`.

### Building the Library

```bash
# Type check
npm run typecheck

# Unused files, exports and dependencies
npm run lint:unused

# Build for production
npm run build
```

The built library will be in `dist/`.

## Data Format

The library expects a Deep Zoom Image (DZI) style directory structure:

```
data/
  dzdata.json              # Metadata file
  dzdata_files/
    0/                     # Zoom level 0 (most zoomed out)
      0_0.nc
    1/                     # Zoom level 1
      0_0.nc
      0_1.nc
      1_0.nc
      1_1.nc
    ...
```

The descriptor fields, the level and tile geometry and the NetCDF tile
layout (format versions 1 and 2) are specified in
[docs/pyramid-format.md](docs/pyramid-format.md).

## Generating Example Data

Use the [SurfaceTopography](https://github.com/ContactEngineering/SurfaceTopography) Python library:

```python
from SurfaceTopography.Generation import fourier_synthesis

# Generate synthetic surface
t = fourier_synthesis((1024, 1024), (1.0, 1.0), 0.8, rms_slope=0.1, unit='mm')

# Export as DZI with NetCDF tiles
t.to_dzi('dzdata', 'output_dir', format='nc', meta_format='json', nc_version=2)
```

## API Reference

### ZoomData

Main entry point for creating a zoomable viewer.

```typescript
const viewer = new ZoomData(options: ZoomDataOptions);
```

#### Options

| Option               | Type                 | Default                 | Description                                         |
| -------------------- | -------------------- | ----------------------- | --------------------------------------------------- |
| `source`             | `TileSource`         | –                       | Where descriptor and tiles come from                |
| `rootUrl`            | `string`             | –                       | Shortcut for a `StaticTileSource`                   |
| `colorPalette`       | `number[]`           | `Palettes.inferno(256)` | Color palette array                                 |
| `minValue`           | `number`             | data minimum            | Value of the first palette entry, in physical units |
| `maxValue`           | `number`             | data maximum            | Value of the last palette entry, in physical units  |
| `noDataColor`        | `number`             | transparent             | Colour of undefined points (ABGR)                   |
| `backgroundColor`    | `number`             | light grey              | Colour behind the image (ABGR)                      |
| `relief`             | `boolean` or options | off                     | Relief shading, see below                           |
| `zoomLevelIncrement` | `number`             | `0.1`                   | Zoom change per scroll                              |

#### Methods

- `start(canvas: HTMLCanvasElement | string): Promise<void>` - Start rendering (a string is the canvas' id)
- `stop(): void` - Stop rendering and cleanup
- `getZoomLevel(): number` - Get current zoom level
- `setZoomLevel(level: number): void` - Set zoom level
- `getMaxZoomLevel(): number` - Get maximum zoom level
- `resetView(): void` - Reset to initial view
- `setColorRange(min: number, max: number): void` - Update color mapping

#### Events

- `onZoomChange: (level: number) => void` - Called when zoom level changes
- `onError: (error: Error) => void` - Called on errors

### ZoomEngine

`ZoomData` is a ready-made viewer. Applications that bring their own UI
use the engine directly: it draws for a view transform set from outside
and has no input handling and no DOM lookups.

```typescript
import { ZoomEngine, DefaultController } from 'zoomdata';

const engine = await ZoomEngine.create(canvas, { source });
// screen = k * image + (x, y), in CSS pixels of the canvas
engine.setView({ k: 0.5, x: 10, y: 20 });
engine.onViewChange = (view) => {
  /* update overlays */
};
const value = engine.sampleAt(imageX, imageY); // physical units, no fetch

// Optional: mouse, touch (drag, pinch) and keyboard input
const controller = new DefaultController(engine, {
  onDoubleClick: (x, y) => console.log('image position', x, y),
});
```

Relief shading lights the map from one direction, which shows fine
structure that the colours alone do not resolve. Like the colour range, it
is applied when drawing and changes instantly:

```typescript
engine.setRelief(true); // light from the top left, 45° above the horizon
engine.setRelief({ azimuth: 315, altitude: 45, exaggeration: 4, ambient: 0.3 });
engine.setRelief(false);
```

Slopes are true slopes if the pyramid states the unit of its heights and
its pixel size; `exaggeration` multiplies them. Slopes come from the level
in view, so the relief of an overview is that of the averaged surface.

Cross-sections through a crosshair are an optional helper:

```typescript
import { CrossSections } from 'zoomdata';

const sections = new CrossSections(engine, {
  overlayCanvas, // transparent canvas on top of the engine's canvas
  horizontalCanvas,
  verticalCanvas,
});
sections.place(imageX, imageY);
const profile = sections.horizontalProfile(); // values in physical units
```

The engine sizes the canvas' drawing buffer to its CSS size times the
device pixel ratio and follows changes of either (`autoResize: true`).

### Color Palettes

Built-in perceptually uniform colormaps (from matplotlib):

```typescript
import { Palettes, inferno, viridis, magma, plasma, grayscale } from 'zoomdata';

// Using the Palettes namespace
const palette1 = Palettes.inferno(256);
const palette2 = Palettes.viridis(128);

// Or import functions directly
const palette3 = inferno(256);
const palette4 = grayscale(64);
```

Available palettes:

- `inferno(n)` - Black to yellow through red (good for heat/intensity)
- `viridis(n)` - Purple to yellow through green (colorblind-friendly)
- `magma(n)` - Black to white through pink
- `plasma(n)` - Blue to yellow through pink
- `grayscale(n)` - Black to white

## License

MIT
