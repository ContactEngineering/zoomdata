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

const tileCache = {};
const cacheExpirationTime = 60000; // Cache expiration time in milliseconds

function clearExpiredTiles() {
  const currentTime = new Date().getTime();

  // Iterate over the tiles in the cache and remove expired ones
  Object.keys(tileCache).forEach(key => {
    const tile = tileCache[key];
    if (currentTime - tile.lastAccessed > cacheExpirationTime) {
      delete tileCache[key];
    }
  });
}



class Tile {
  colorMapper;
  url;
  tileCanvas;
  lastAccessed; 

  constructor(colorMapper, url) {
    this.colorMapper = colorMapper;
    this.url = url;
    this.tileCanvas = null;
    this.lastAccessed = 0;
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
        const adjustedXPos = xPos - overlap * width;
        const adjustedYPos = yPos - overlap * height;
        const adjustedWidth = width + 2 * overlap * width;
        const adjustedHeight = height + 2 * overlap * height;
        context.drawImage(tileCanvas, adjustedXPos, adjustedYPos, adjustedWidth, adjustedHeight);
        this.lastAccessed = new Date().getTime(); // Update the lastAccessed timestamp
      });
    } else {
      context.drawImage(this.tileCanvas, xPos, yPos, width, height);
      this.lastAccessed = new Date().getTime(); // Update the lastAccessed timestamp
    }
  }
}


/* DeepZoomConfiguration represents the global deep zoom information, such as number of tiles and overlap */
class DeepZoomConfiguration {
  imageSize;
  tileSize;
  overlap;

  constructor(url) {

  }

  tileSizeAtZoomLevel(zoomLevel) {

  }
}


/* Tiled image is a representation at a specific zoom level. It takes care of
   cachings tiles and can render to a rendering context. */
class TiledImage {
  tileCache;

  constructor(deepZoomConfiguration, zoomLevel) {
    this.tileCache = {};
  }

  renderTo(context, xPos, yPos, fractionalZoomLevel) {

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

updateVisualizationWithCache(Z, renderingPosition);

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

let overlap;

let maxZoomLevel;

function updateVisualizationWithCache(Z, renderingPosition) {
  const rootUrl = 'http://localhost:8000/test/example_files/synthetic_square/';
  const baseUrl = `${rootUrl}dzdata_files/`;

  const colorMapper = new ColorMapper(Palettes.inferno(20), 0.0, 1.0);
  const canvas = document.getElementById('myCanvas');
  const ctx = canvas.getContext('2d');
  // Clear expired tiles before rendering
  clearExpiredTiles();

  axios.get(`${rootUrl}dzdata.json`).then(response => {
    const imageSize = response.data.Image.Size;
    const tileSize = response.data.Image.TileSize;
    overlap = response.data.Image.Overlap;
    console.log("overlap", overlap);
    maxZoomLevel = Math.ceil(Math.log2(Math.max(imageSize.Width, imageSize.Height)));
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

    const visibleTiles = [];

    for (let rowIndex = 0; rowIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numRows)))); rowIndex++) {
      for (let columnIndex = 0; columnIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numColumns)))); columnIndex++) {
        const fileName = `${rowIndex}_${columnIndex}.nc`;
        const netcdfUrl = `${baseUrl}${Math.floor(Z)}/${fileName}`;

        const xPos = renderingPosition.x + columnIndex * (cx / Math.max(0.5, (Math.log2(numColumns)))) - overlap * cx;
        const yPos = renderingPosition.y + rowIndex * (cy / Math.max(0.5, (Math.log2(numRows)))) - overlap * cy;
        const cellWidth = cx / Math.max(0.5, (Math.log2(numColumns))) + 2 * overlap * cx;
        const cellHeight = cy / Math.max(0.5, (Math.log2(numRows))) + 2 * overlap * cy;



        const tileIsVisible = (
          xPos + cellWidth >= 0 && xPos <= cx &&
          yPos + cellHeight >= 0 && yPos <= cy
        );

        if (tileIsVisible) {
          if (!tileCache[`${rowIndex}_${columnIndex}`]) {
            tileCache[`${rowIndex}_${columnIndex}`] = new Tile(colorMapper, netcdfUrl);
          }
          tileCache[`${rowIndex}_${columnIndex}`].renderTo(ctx, xPos, yPos, cellWidth, cellHeight);
        }
      }
    }
    console.log(`Current Z value: ${Z}`);
  });
}

// ...
let newzlf;

function updateZoomValues(Z, MCx, MCy, MDx, MDy) {
  newzlf = (2 ** (maxZoomLevel - Z + 2));
  renderingPosition.x = MCx - (MDx / newzlf);
  renderingPosition.y = MCy - (MDy / newzlf);
}


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
    if (Z < 10) {
      Z = parseFloat((Z + 0.1).toFixed(2));
      updateZoomValues(Z, MCx, MCy, MDx, MDy); // Call the function to update newzlf and renderingPosition
    }
  } else {
    if (Z > 0) {
      Z = parseFloat((Z - 0.1).toFixed(2));
      updateZoomValues(Z, MCx, MCy, MDx, MDy); // Call the function to update newzlf and renderingPosition
    }
  }

  console.log(renderingPosition.x, renderingPosition.y);

  // Clear the canvas and update the visualization with the new rendering position
  ctx.clearRect(0, 0, cx, cy);
  updateVisualizationWithCache(Z, renderingPosition);
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
    // Clear the canvas and update the visualization with the new rendering position
    const ctx = canvas.getContext('2d');
    const cx = canvas.width;
    const cy = canvas.height;

    // Update the rendering position based on mouse move and drag offset
    renderingPosition.x = event.clientX - canvas.getBoundingClientRect().left - dragOffset.x;
    renderingPosition.y = event.clientY - canvas.getBoundingClientRect().top - dragOffset.y;

    ctx.clearRect(0, 0, cx, cy);
    updateVisualizationWithCache(Z, renderingPosition);
  }
});


canvas.addEventListener('mouseup', () => {
  // Stop dragging
  isDragging = false;
});

renderColorBar(Palettes.inferno(20));