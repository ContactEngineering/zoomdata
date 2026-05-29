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
  minValue: 0.0,
  maxValue: 1.0,
});

await viewer.start('canvasId');
```

## Development

### Prerequisites

- Node.js 18+
- Python 3 (for the data server)

### Setup

```bash
# Install dependencies
npm install
```

### Running the Demo

The demo requires two servers running simultaneously:

**Terminal 1 - Data Server** (serves NetCDF tile data with CORS headers):

```bash
npm run serve-data
# or directly: python cors_server.py
```

This starts a Python HTTP server on port 8000 that serves the example data files.

**Terminal 2 - Dev Server** (Vite dev server with hot reload):

```bash
npm run dev
```

This starts the Vite dev server on port 3000 and opens the demo in your browser.

### Building the Library

```bash
# Type check
npm run typecheck

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

### dzdata.json Format

```json
{
  "Image": {
    "Size": {
      "Width": 1024,
      "Height": 1024
    },
    "TileSize": 256,
    "Overlap": 0
  }
}
```

### NetCDF Tile Format

Each `.nc` file must contain:

- A `heights` variable with the data values
- `x` and `y` dimensions

## Generating Example Data

Use the [SurfaceTopography](https://github.com/ContactEngineering/SurfaceTopography) Python library:

```python
from SurfaceTopography.Generation import fourier_synthesis

# Generate synthetic surface
t = fourier_synthesis((1024, 1024), (1.0, 1.0), 0.8, rms_slope=0.1, unit='mm')

# Export as DZI with NetCDF tiles
t.to_dzi('dzdata', 'output_dir', format='nc', meta_format='json')
```

## API Reference

### ZoomData

Main entry point for creating a zoomable viewer.

```typescript
const viewer = new ZoomData(options: ZoomDataOptions);
```

#### Options

| Option               | Type       | Default                 | Description                        |
| -------------------- | ---------- | ----------------------- | ---------------------------------- |
| `rootUrl`            | `string`   | required                | URL where `dzdata.json` is located |
| `colorPalette`       | `number[]` | `Palettes.inferno(256)` | Color palette array                |
| `minValue`           | `number`   | `0.0`                   | Minimum data value                 |
| `maxValue`           | `number`   | `1.0`                   | Maximum data value                 |
| `zoomLevelIncrement` | `number`   | `0.1`                   | Zoom change per scroll             |
| `debug`              | `boolean`  | `false`                 | Show tile borders                  |

#### Methods

- `start(canvas: HTMLCanvasElement | string): Promise<void>` - Start rendering
- `stop(): void` - Stop rendering and cleanup
- `getZoomLevel(): number` - Get current zoom level
- `setZoomLevel(level: number): void` - Set zoom level
- `getMaxZoomLevel(): number` - Get maximum zoom level
- `resetView(): void` - Reset to initial view
- `setColorRange(min: number, max: number): void` - Update color mapping

#### Events

- `onZoomChange: (level: number) => void` - Called when zoom level changes
- `onError: (error: Error) => void` - Called on errors

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
