import {Palettes} from '@bokeh/bokehjs';
import { version } from '@bokeh/bokehjs';
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';

// URL of the NetCDF file
const netcdfUrl = 'http://localhost:8000/test/example_files/synthetic_square/dzdata_files/7/0_0.nc';

// Define the magnification level (Z)
const Z = 0; // 

// Define the tile size (t)
const t = 256; // doubt


// Select the canvas element from your HTML
const canvas = document.getElementById('myCanvas');

// Define the canvas size (cx and cy)
const cx = canvas.width; // You can change this value as needed
const cy = canvas.height; // You can change this value as needed

// Make a GET request using Axios
axios.get(netcdfUrl, { responseType: 'arraybuffer' })
  .then((response) => response.data)
  .then((data) => {
    const netcdfReader = new NetCDFReader(data);
    const heights = netcdfReader.getDataVariable('heights');

    const minValue = Math.min(...heights);
    const maxValue = Math.max(...heights);

    const colorPalette = Palettes.inferno(20);

    const dimensions = netcdfReader.dimensions;
    const xDim = dimensions.find((dim) => dim.name === 'x');
    const yDim = dimensions.find((dim) => dim.name === 'y');
    const ySize = yDim.size;
    const xSize = xDim.size;

    const startX = 0; // Lower left canvas X pos
    const startY = 0; // Lower left canvas Y pos

    const effectiveXSize = xSize / (2 ** Z);
    const effectiveYSize = ySize / (2 ** Z);

    const tilesToRenderX = Math.ceil(cx / t);
    const tilesToRenderY = Math.ceil(cy / t);

    const ctx = canvas.getContext('2d');

    for (let ty = 0; ty < tilesToRenderY; ty++) {
      for (let tx = 0; tx < tilesToRenderX; tx++) {
        const tileX = startX + tx * t;
        const tileY = startY + ty * t;

        if (tileX < effectiveXSize && tileY < effectiveYSize) {
          for (let dy = 0; dy < t; dy++) {
            for (let dx = 0; dx < t; dx++) {
              const canvasX = tx * t + dx;
              const canvasY = ty * t + dy;

              const dataX = Math.floor(tileX + dx * (2 ** Z));
              const dataY = Math.floor(tileY + dy * (2 ** Z));

              if (dataX < xSize && dataY < ySize) {
                const value = heights[dataY * xSize + dataX];
                const scaledValue = (value - minValue) / (maxValue - minValue);
                const colorIndex = Math.floor(scaledValue * (colorPalette.length - 1));
                const color = colorPalette[colorIndex];

                ctx.fillStyle = '#' + (color.toString(16).substring(0, 6));
                ctx.fillRect(canvasX, canvasY, 1, 1);
              }
            }
          }
        }
      }
    }
  });

