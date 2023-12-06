import axios from 'axios';
import { Palettes } from '@bokeh/bokehjs';
import { NetCDFReader } from 'netcdfjs';
import { VSpanView } from '@bokeh/bokehjs/build/js/lib/models/glyphs/vspan';

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
    const imageDataView = new DataView(imageData.data.buffer);

    for (let y = 0; y < ySize; y++) {
      for (let x = 0; x < xSize; x++) {
        const pixelIndex = y * xSize + x; // Each pixel has 4 values (R, G, B, A)

        const value = data[pixelIndex];
        const scaledValue = (value - this.minValue) / (this.maxValue - this.minValue);
        const colorIndex = Math.floor(scaledValue * (this.colorPalette.length - 1));
        const color = this.colorPalette[colorIndex];

        imageDataView.setUint32(4*pixelIndex, color);
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


/* The Tile class represents a single tile from a deep zoom stack. It takes
   care of fetching and caching the data and can render itself to a context. */
class Tile {
  colorMapper;
  url;
  tileCanvas;
  lastAccessed;
  tileWidth;
  tileHeight;

  constructor(colorMapper, url) {
    this.colorMapper = colorMapper;
    this.url = url;
    this.tileCanvas = null;
    this.lastAccessed = 0;
    this.tileWidth = null;
    this.tileHeight = null;
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
      this.tileWidth = xDim.size;
      this.tileHeight = yDim.size;

      this.tileCanvas = this.colorMapper.render(heights, this.tileWidth, this.tileHeight);

      return this.tileCanvas;
    });
  }

  renderTo(context, xPos, yPos, width, height) {
    if (this.tileCanvas == null) {
      this.fetch().then(tileCanvas => {
        this.tileCanvas = tileCanvas;
        context.drawImage(this.tileCanvas, xPos, yPos, width, height);
        this.lastAccessed = new Date().getTime(); // Update the lastAccessed timestamp
      });
    } else {
      context.drawImage(this.tileCanvas, xPos, yPos, width, height);
      this.lastAccessed = new Date().getTime(); // Update the lastAccessed timestamp
    }
    // Debug!! Draw rectangle to indicate rendered regions
    context.strokeStyle = "black";
    context.strokeRect(xPos, yPos, width, height);
  }
}


/* ZoomConfiguration represents the global zoom information, such as number of
   tiles and overlap */
class ZoomConfiguration {
  rootUrl;
  baseUrl;
  imageSize;
  tileSize;
  overlap;
  maxZoomLevel;

  constructor(rootUrl) {
    this.rootUrl = rootUrl;
    this.baseUrl = `${rootUrl}dzdata_files/`;
    this.imageSize = null;
    this.tileSize = null;
    this.overlap = null;
    this.maxZoomLevel = null;
  }

  fetch() {
    return axios.get(`${this.rootUrl}dzdata.json`).then(response => {
      this.imageSize = response.data.Image.Size;
      this.tileSize = response.data.Image.TileSize;
      this.overlap = response.data.Image.Overlap;
      this.maxZoomLevel = Math.ceil(Math.log2(Math.max(this.imageSize.Width, this.imageSize.Height)));
      return this;
    });
  }

  scaleFactorAtZoomLevel(zoomLevel) {
    return 2 ** (this.maxZoomLevel - zoomLevel);
  }
}


/* Tiled image is a representation at a specific zoom level. It takes care of
   cachings tiles and can render to a rendering context. */
class TiledImage {
  zoomConfiguration;
  colorMapper;
  tileCache;

  constructor(zoomConfiguration, colorMapper) {
    this.zoomConfiguration = zoomConfiguration;
    this.colorMapper = colorMapper;
    this.tileCache = {};
  }

  renderTo(canvas, xPos, yPos, fractionalZoomLevel) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Scale image to zoom level; this is the zoom level at which we render
    const scaleFactor = this.zoomConfiguration.scaleFactorAtZoomLevel(fractionalZoomLevel);
    const scaledWidth = this.zoomConfiguration.imageSize.Width / scaleFactor;
    const scaledHeight = this.zoomConfiguration.imageSize.Height / scaleFactor;

    // Find level in image stack to render; this is the zoom level for which we load tile data
    const dataZoomLevel = Math.round(fractionalZoomLevel) < 0 ? 0 : 
      Math.round(fractionalZoomLevel) > this.zoomConfiguration.maxZoomLevel ? this.zoomConfiguration.maxZoomLevel :
      Math.round(fractionalZoomLevel);

    const dataScaleFactor = this.zoomConfiguration.scaleFactorAtZoomLevel(dataZoomLevel);
    const numColumns = Math.ceil(this.zoomConfiguration.imageSize.Width / (dataScaleFactor * this.zoomConfiguration.tileSize));
    const numRows = Math.ceil(this.zoomConfiguration.imageSize.Height / (dataScaleFactor * this.zoomConfiguration.tileSize));
    const scaledTileSize = this.zoomConfiguration.tileSize * dataScaleFactor / scaleFactor;
  
    console.log(fractionalZoomLevel, dataZoomLevel);

    for (let columnIndex = 0; columnIndex < numColumns; columnIndex++) {
      for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
        const fileName = `${rowIndex}_${columnIndex}.nc`;
        const dataUrl = `${this.zoomConfiguration.baseUrl}${dataZoomLevel}/${fileName}`;

        const tileXPos = xPos + columnIndex * scaledTileSize;
        const tileYPos = yPos + rowIndex * scaledTileSize;

        const tileIsVisible = (
          tileXPos >= -scaledTileSize && tileXPos <= canvas.width &&
          tileYPos >= -scaledTileSize && tileYPos <= canvas.height
        );

        const key = `${dataZoomLevel}/${rowIndex}_${columnIndex}`;
        if (tileIsVisible) {
          if (!this.tileCache[key]) {
            this.tileCache[key] = new Tile(this.colorMapper, dataUrl);
          }
          this.tileCache[key].renderTo(context, tileXPos, tileYPos, scaledTileSize, scaledTileSize);
        }
      }
    }

  }
}


/* The full zoomable stack */
class ZoomData {
  canvasElementId;
  rootUrl;
  zoomLevelIncrement;

  canvas;
  colorMapper;
  tiledImage;
  xPos;
  yPos;
  zoomConfiguration;
  zoomLevel;

  isDragging;
  xDragOffset;
  yDragOffset;

  constructor(canvasElementId, rootUrl, zoomLevelIncrement=0.1) {
    this.canvasElementId = canvasElementId;
    this.rootUrl = rootUrl;
    this.zoomLevelIncrement = zoomLevelIncrement;

    this.canvas = null;
    this.colorMapper = null;
    this.tiledImage = null;
    this.xPos = 0;
    this.yPos = 0;
    this.zoomConfiguration = null;
    this.zoomLevel = null;

    this.isDragging = false;
    this.xDragOffset = 0;
    this.yDragOffset = 0;
  }

  startRendering() {
    this.canvas = document.getElementById(this.canvasElementId);
    this.zoomConfiguration = new ZoomConfiguration(this.rootUrl);
    this.colorMapper = new ColorMapper(Palettes.inferno(20), 0.0, 1.0);

    this.zoomConfiguration.fetch().then(zoomConfiguration => {
      this.zoomLevel = zoomConfiguration.maxZoomLevel;
      this.tiledImage = new TiledImage(zoomConfiguration, this.colorMapper);
      this.tiledImage.renderTo(this.canvas, this.xPos, this.yPos, this.zoomLevel);

      // Install event handlers
      this.canvas.addEventListener('wheel', (event) => this.wheelEvent(event), { passive:false });
      this.canvas.addEventListener('mousedown', (event) => this.mouseDownEvent(event));
      this.canvas.addEventListener('mousemove', (event) => this.mouseMoveEvent(event));
      this.canvas.addEventListener('mouseup', (event) => this.mouseUpEvent(event));
    });
  }

  wheelEvent(event) {
    // Prevent normal scrolling
    event.preventDefault();

    // Store the current mouse position in canvas coordinates
    const canvasRect = this.canvas.getBoundingClientRect();
    const xPosCanvasMouse = event.clientX - canvasRect.left;
    const yPosCanvasMouse = event.clientY - canvasRect.top;

    // Calculate the change in mouse position in data coordinates
    const oldScaleFactor = this.zoomConfiguration.scaleFactorAtZoomLevel(this.zoomLevel)
    const xPosDataMouse = (xPosCanvasMouse - this.xPos) * oldScaleFactor;
    const yPosDataMouse = (yPosCanvasMouse - this.yPos) * oldScaleFactor;

    // Update zoom level
    if (event.deltaY > 0) {
      this.zoomLevel += this.zoomLevelIncrement;
    } else if (event.deltaY < 0) {
      this.zoomLevel -= this.zoomLevelIncrement;
    }

    // Shift image such that mouse position stays invariant
    const newScaleFactor = this.zoomConfiguration.scaleFactorAtZoomLevel(this.zoomLevel)
    this.xPos = xPosCanvasMouse - xPosDataMouse / newScaleFactor;
    this.yPos = yPosCanvasMouse - yPosDataMouse / newScaleFactor;
  
    // Rerender tiled image
    this.tiledImage.renderTo(this.canvas, this.xPos, this.yPos, this.zoomLevel);
  }

  mouseDownEvent(event) {
    // Start dragging
    this.isDragging = true;
  
    // Update the drag offset based on the mouse click coordinates
    const canvasRect = this.canvas.getBoundingClientRect();
    this.xDragOffset = event.clientX - canvasRect.left - this.xPos;
    this.yDragOffset = event.clientY - canvasRect.top - this.yPos;
  }
  
  mouseMoveEvent(event) {
    if (this.isDragging) {
      // Update the rendering position based on mouse move and drag offset
      const canvasRect = this.canvas.getBoundingClientRect();
      this.xPos = event.clientX - canvasRect.left - this.xDragOffset;
      this.yPos = event.clientY - canvasRect.top - this.yDragOffset;
  
      // Rerender tiled image
      this.tiledImage.renderTo(this.canvas, this.xPos, this.yPos, this.zoomLevel);
    }
  }
  
  mouseUpEvent(event) {
    // Stop dragging
    this.isDragging = false;
  }
}


/* For demonstration purposes, render an example file to 'myCanvas' */
const zoomData = new ZoomData('myCanvas', 'http://localhost:8000/test/example_files/synthetic_square/');
zoomData.startRendering();

/*
function updateVisualizationWithCache(Z, renderingPosition) {
  const baseUrl = `${rootUrl}dzdata_files/`;

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
    console.log(`Current Z value: ${Z}`);
  });
}

// ...
let newzlf;

function updateZoomValues(Z, MCx, MCy, MDx, MDy) {
  newzlf = (2 ** (maxZoomLevel - Z + 2));
  console.log(zoomLevelFactor, newzlf);
  renderingPosition.x = MCx - (MDx / newzlf) ;
  renderingPosition.y = MCy - (MDy / newzlf) ;
  return Promise.resolve(); // Resolve the Promise immediately
}


window.addEventListener('wheel', (event) => {
  // Store the current mouse position in canvas coordinates
  const MCx = event.clientX - canvas.getBoundingClientRect().left;
  const MCy = event.clientY - canvas.getBoundingClientRect().top;

  // Calculate the change in mouse position in data coordinates
  const MDx = (MCx - renderingPosition.x) * (zoomLevelFactor);
  const MDy = (MCy - renderingPosition.y) * (zoomLevelFactor);

    // Update the Z value
  if (event.deltaY > 0) {
    if (Z < 10) {
      Z = parseFloat((Z + 0.1).toFixed(2));
      updateZoomValues(Z, MCx, MCy, MDx, MDy)
        .then(() => {
          const canvas = document.getElementById('myCanvas');
          const ctx = canvas.getContext('2d');
          const cx = canvas.width;
          const cy = canvas.height;

          // Clear the canvas and update the visualization with the new rendering position
          //ctx.clearRect(0, 0, cx, cy);
          updateVisualizationWithCache(Z, renderingPosition);
        });
    }
  } else {
    if (Z > 0) {
      Z = parseFloat((Z - 0.1).toFixed(2));
      updateZoomValues(Z, MCx, MCy, MDx, MDy)
        .then(() => {
          const canvas = document.getElementById('myCanvas');
          const ctx = canvas.getContext('2d');
          const cx = canvas.width;
          const cy = canvas.height;

          // Clear the canvas and update the visualization with the new rendering position
          //ctx.clearRect(0, 0, cx, cy);
          updateVisualizationWithCache(Z, renderingPosition);
        });
    }
  }
});
// ...


//const canvas = document.getElementById('myCanvas');

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


let overlap;

let maxZoomLevel;


*/

function renderColorBar(colorPalette) {
  const colorBarGradient = document.getElementById('colorBarGradient');
  colorBarGradient.innerHTML = '';

  colorPalette.forEach((color) => {
    const colorBlock = document.createElement('div');
    colorBlock.style.backgroundColor = `#${color.toString(16).substring(0, 6)}`;
    colorBarGradient.appendChild(colorBlock);
  });
}

renderColorBar(Palettes.inferno(20));
