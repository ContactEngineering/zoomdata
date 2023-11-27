import {Palettes} from '@bokeh/bokehjs';
import { version } from '@bokeh/bokehjs';
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';

// Define the magnification level (Z)
let Z = 9.8;


// Define the initial rendering position
let renderingPosition = { x: 0, y: 0 };
let isDragging = false;
let dragOffset = { x: 0, y: 0 }; // Store the initial offset

let numColumns, numRows;


let zoomLevelFactor =1;  // Declare zoomLevelFactor outside of function

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
const imageDataCache = {};

function renderTileToImageDataAndCache(netcdfReader, minValue, maxValue, colorPalette, rowIndex, columnIndex) {  
  const heights = netcdfReader.getDataVariable('heights');
  const dimensions = netcdfReader.dimensions;
  const xDim = dimensions.find((dim) => dim.name === 'y');
  const yDim = dimensions.find((dim) => dim.name === 'x');
  const xSize = xDim.size;
  const ySize = yDim.size;

  const imageData = new ImageData(xSize, ySize);
  const data = new Uint32Array(imageData.data.buffer);

  for (let y = 0; y < ySize; y++) {
    for (let x = 0; x < xSize; x++) {
      const value = heights[y * xSize + x];
      const scaledValue = (value - minValue) / (maxValue - minValue);
      const colorIndex = Math.floor(scaledValue * (colorPalette.length - 1));
      const color = colorPalette[colorIndex];

      const pixelIndex = (y * xSize + x); // Each pixel has 4 values (R, G, B, A)
      data[pixelIndex] = color;
      /*
      data[pixelIndex] = color >> 16 & 0xFF;     // Red component
      data[pixelIndex + 1] = color >> 8 & 0xFF;  // Green component
      data[pixelIndex + 2] = color & 0xFF;       // Blue component
      data[pixelIndex + 3] = 255;                // Alpha component (fully opaque)
      */
    }
  }

  const tileCanvas = new OffscreenCanvas(xSize, ySize);
  const tileCtx = tileCanvas.getContext('2d');
  tileCtx.putImageData(imageData, 0, 0);

  // Cache the imageData
  imageDataCache[`${rowIndex}_${columnIndex}`] = tileCanvas;

  return tileCanvas;
}

function updateVisualizationWithCache(Z) {
  const rootUrl = 'http://localhost:8000/test/example_files/synthetic_square/';
  const baseUrl = `${rootUrl}dzdata_files/`;

  axios.get(`${rootUrl}dzdata.json`).then(response => {
    const imageSize = response.data.Image.Size;
    const tileSize = response.data.Image.TileSize;
    const maxZoomLevel = Math.ceil(Math.log2(Math.max(imageSize.Width, imageSize.Height)));
    zoomLevelFactor = (2 ** (maxZoomLevel - Z + 2));
    console.log("zlf ",zoomLevelFactor);
    const widthAtZoomLevel = imageSize.Width / zoomLevelFactor;
    const heightAtZoomLevel = imageSize.Height / zoomLevelFactor;
    const numColumns = (widthAtZoomLevel / tileSize);
    const numRows = (heightAtZoomLevel / tileSize);

    console.log('numColumns:', numColumns);
    console.log('numRows:', numRows);

    updateScaleBar(Z);
    const canvas = document.getElementById('myCanvas');
    const cx = canvas.width;
    const cy = canvas.height;

    let atLeastOneFileLoaded = false;
    const minValue = 0.0;
    const maxValue = 1.0;
    const colorPalette = Palettes.inferno(20);

    for (let rowIndex = 0; rowIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numRows)))); rowIndex++) {
      for (let columnIndex = 0; columnIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numColumns)))); columnIndex++) {
        const fileName = `${rowIndex}_${columnIndex}.nc`;
        const netcdfUrl = `${baseUrl}${Math.floor(Z)}/${fileName}`;

        const xPos =renderingPosition.x + columnIndex * (cx / Math.max(0.5, (Math.log2(numColumns))));
        const yPos = renderingPosition.y + rowIndex * (cy / Math.max(0.5, (Math.log2(numRows))));
        const cellWidth = cx / Math.max(0.5, (Math.log2(numColumns)));
        const cellHeight = cy / Math.max(0.5, (Math.log2(numRows)));

        if (imageDataCache[`${rowIndex}_${columnIndex}`]) {
          // If imageData is already cached, use it directly
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imageDataCache[`${rowIndex}_${columnIndex}`], xPos, yPos, cellWidth, cellHeight);

          atLeastOneFileLoaded = true;
        } else {
          axios
            .get(netcdfUrl, { responseType: 'arraybuffer' })
            .then((response) => response.data)
            .then((data) => {
              const netcdfReader = new NetCDFReader(data);
              const imageData = renderTileToImageDataAndCache(
                netcdfReader,
                minValue,
                maxValue,
                colorPalette,
                rowIndex,
                columnIndex
              );

              const ctx = canvas.getContext('2d');
              ctx.drawImage(imageData, xPos, yPos, cellWidth, cellHeight);

              atLeastOneFileLoaded = true;
            })
            .catch((error) => {
              console.error(`Error loading NetCDF file: ${netcdfUrl}`);
              console.error(error);
            });
        }
      }
    }

    if (atLeastOneFileLoaded) {
      console.log('Successfully loaded');
    } else {
      console.log('No files were successfully loaded');
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
  const MDx = (MCx - renderingPosition.x) *(zoomLevelFactor);
  const MDy = (MCy - renderingPosition.y) *(zoomLevelFactor);

  console.log(MDx,MDy,MCx,MCy,renderingPosition.x,renderingPosition.y,zoomLevelFactor);

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
  renderingPosition.x = MCx - (MDx/ zoomLevelFactor);
  renderingPosition.y = MCy - (MDy/ zoomLevelFactor);

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