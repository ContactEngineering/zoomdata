import axios from 'axios';
import { Palettes } from '@bokeh/bokehjs';
import { NetCDFReader } from 'netcdfjs';

/* The ColorMapper class turns a data array into an offscreen canvas element
   that can be rendered onto a context */
class ColorMapper {
  colorPalette;
  minValue;
  maxValue;

  constructor(colorPalette, minValue, maxValue) {
    this.colorPalette = colorPalette;
    this.minValue = minValue;
    this.maxValue = maxValue;
  }

  render(data, xSize, ySize) {
    // Create image data buffer and fill it
    const imageData = new ImageData(xSize, ySize);
    const imageDataArray = new Uint32Array(imageData.data.buffer);

    for (let y = 0; y < ySize; y++) {
      for (let x = 0; x < xSize; x++) {
        const value = data[y * xSize + x];
        const scaledValue = (value - this.minValue) / (this.maxValue - this.minValue);
        const colorIndex = Math.floor(scaledValue * (this.colorPalette.length - 1));
        const color = this.colorPalette[colorIndex];

        const pixelIndex = (y * xSize + x); // Each pixel has 4 values (R, G, B, A)
        imageDataArray[pixelIndex] = color;
      }
    }

    // Render image to offscreen canvas
    const tileCanvas = new OffscreenCanvas(xSize, ySize);
    tileCanvas.getContext('2d').putImageData(imageData, 0, 0);

    return tileCanvas;
  }
}


// Cache the imageData
//    tileCache[`${rowIndex}_${columnIndex}`] = tileCanvas;
// if (tileCache[`${rowIndex}_${columnIndex}`]) {
//  const ctx = canvas.getContext('2d');

class Tile {
  colorMapper;
  url;
  tileCanvas;

  constructor(colorMapper, url) {
    this.colorMapper = colorMapper;
    this.url = url;
    this.tileCanvas = null;
  }

  clearCache() {
    this.tileCanvas = null;
  }

  fetch() {
    return axios.get(this.url, { responseType: 'arraybuffer' }).then(response => {
      const netcdfReader = new NetCDFReader(response.data);
      const heights = netcdfReader.getDataVariable('heights');
      const dimensions = netcdfReader.dimensions;
      const yDim = dimensions.find((dim) => dim.name === 'x');
      const xDim = dimensions.find((dim) => dim.name === 'y');
      const xSize = xDim.size;
      const ySize = yDim.size;

      this.tileCanvas = this.colorMapper.render(heights, xSize, ySize);

      return this.tileCanvas;
    });
  }

  renderTo(context, xPos, yPos, width, height) {
    if (this.tileCanvas == null) {
      this.fetch().then(tileCanvas => {
        context.drawImage(tileCanvas, xPos, yPos, width, height);
      });
    } else {
      // If imageData is already cached, use it directly
      context.drawImage(this.tileCanvas, xPos, yPos, width, height);     
    }
  }
}




// Define the magnification level (Z)
let Z = 9.8;


// Define the initial rendering position
let renderingPosition = { x: 0, y: 0 };
let isDragging = false;
let dragOffset = { x: 0, y: 0 }; // Store the initial offset

let numColumns, numRows;


let zoomLevelFactor = 1;  // Declare zoomLevelFactor outside of function

updateVisualizationWithCache(Z);

function updateScaleBar(Z) {
  const scaleValueElement = document.getElementById('scaleValue');
  scaleValueElement.textContent = `Z = ${Z}`;
}

function renderColorBar(colorPalette) {
  const colorBarGradient = document.getElementById('colorBarGradient');
  colorBarGradient.innerHTML = '';

  colorPalette.forEach((color) => {
    const colorBlock = document.createElement('div');
    colorBlock.style.backgroundColor = `#${color.toString(16).substring(0, 6)}`;
    colorBarGradient.appendChild(colorBlock);
  });
}
const tileCache = {};

function updateVisualizationWithCache(Z) {
  const rootUrl = 'http://localhost:8000/test/example_files/synthetic_square/';
  const baseUrl = `${rootUrl}dzdata_files/`;

  const colorMapper = new ColorMapper(Palettes.inferno(20), 0.0, 1.0);
  const canvas = document.getElementById('myCanvas');
  const ctx = canvas.getContext('2d');

  axios.get(`${rootUrl}dzdata.json`).then(response => {
    const imageSize = response.data.Image.Size;
    const tileSize = response.data.Image.TileSize;
    const maxZoomLevel = Math.ceil(Math.log2(Math.max(imageSize.Width, imageSize.Height)));
    zoomLevelFactor = (2 ** (maxZoomLevel - Z + 2));
    console.log("zlf ", zoomLevelFactor);
    const widthAtZoomLevel = imageSize.Width / zoomLevelFactor;
    const heightAtZoomLevel = imageSize.Height / zoomLevelFactor;
    const numColumns = (widthAtZoomLevel / tileSize);
    const numRows = (heightAtZoomLevel / tileSize);

    console.log('numColumns:', numColumns);
    console.log('numRows:', numRows);

    updateScaleBar(Z);
    const cx = canvas.width;
    const cy = canvas.height;

    for (let rowIndex = 0; rowIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numRows)))); rowIndex++) {
      for (let columnIndex = 0; columnIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numColumns)))); columnIndex++) {
        const fileName = `${rowIndex}_${columnIndex}.nc`;
        const netcdfUrl = `${baseUrl}${Math.floor(Z)}/${fileName}`;

        const xPos = renderingPosition.x + columnIndex * (cx / Math.max(0.5, (Math.log2(numColumns))));
        const yPos = renderingPosition.y + rowIndex * (cy / Math.max(0.5, (Math.log2(numRows))));
        const cellWidth = cx / Math.max(0.5, (Math.log2(numColumns)));
        const cellHeight = cy / Math.max(0.5, (Math.log2(numRows)));

        if (!tileCache[`${rowIndex}_${columnIndex}`]) {
          tileCache[`${rowIndex}_${columnIndex}`] = new Tile(colorMapper, netcdfUrl);
        }
        tileCache[`${rowIndex}_${columnIndex}`].renderTo(ctx, xPos, yPos, cellWidth, cellHeight);
      }
    }

    console.log(`Current Z value: ${Z}`);
  });
}

// ...

window.addEventListener('wheel', (event) => {
  const canvas = document.getElementById('myCanvas');
  const ctx = canvas.getContext('2d');
  const cx = canvas.width;
  const cy = canvas.height;


  // Store the current mouse position in canvas coordinates
  const MCx = event.clientX - canvas.getBoundingClientRect().left;
  const MCy = event.clientY - canvas.getBoundingClientRect().top;

  // Calculate the change in mouse position in data coordinates
  const MDx = (MCx - renderingPosition.x) * (zoomLevelFactor);
  const MDy = (MCy - renderingPosition.y) * (zoomLevelFactor);

  console.log(MDx, MDy, MCx, MCy, renderingPosition.x, renderingPosition.y, zoomLevelFactor);

  // Update the Z value
  if (event.deltaY > 0) {
    if (Z > 0) {
      Z = parseFloat((Z - 0.1).toFixed(2));
    }
  } else {
    if (Z < 10) {
      Z = parseFloat((Z + 0.1).toFixed(2));
    }
  }

  // Update rendering position based on the invariant conditions
  renderingPosition.x = MCx - (MDx / zoomLevelFactor);
  renderingPosition.y = MCy - (MDy / zoomLevelFactor);

  // Clear the canvas and update the visualization with the new rendering position
  ctx.clearRect(0, 0, cx, cy);
  updateVisualizationWithCache(Z);
});

// ...


const canvas = document.getElementById('myCanvas');

canvas.addEventListener('mousedown', (event) => {
  // Start dragging
  isDragging = true;

  // Update the drag offset based on the mouse click coordinates
  dragOffset.x = event.clientX - canvas.getBoundingClientRect().left - renderingPosition.x;
  dragOffset.y = event.clientY - canvas.getBoundingClientRect().top - renderingPosition.y;
});

canvas.addEventListener('mousemove', (event) => {
  if (isDragging) {
    // Update the rendering position based on mouse move and drag offset
    renderingPosition.x = event.clientX - canvas.getBoundingClientRect().left - dragOffset.x;
    renderingPosition.y = event.clientY - canvas.getBoundingClientRect().top - dragOffset.y;

    // Clear the canvas and update the visualization with the new rendering position
    const ctx = canvas.getContext('2d');
    const cx = canvas.width;
    const cy = canvas.height;

    ctx.clearRect(0, 0, cx, cy);
    updateVisualizationWithCache(Z);
  }
});

canvas.addEventListener('mouseup', () => {
  // Stop dragging
  isDragging = false;
});

renderColorBar(Palettes.inferno(20));