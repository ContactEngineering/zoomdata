import {Palettes} from '@bokeh/bokehjs';
import { version } from '@bokeh/bokehjs';
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';

// Define the magnification level (Z)
let Z = 9.8; // 

// Initial visualization
 updateVisualization(Z);

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


// Loop through each NetCDF file URL
function updateVisualization(Z) {

  // Define the constant part of the URL
  const rootUrl = 'http://localhost:8000/test/example_files/synthetic_square/';
  const baseUrl = `${rootUrl}dzdata_files/`;

  // Read JSON
  axios.get(`${rootUrl}dzdata.json`).then(response => {
    console.log(response.data);
    console.log(response.data.Image.Size.Height);

    // Extract data file size from metadata file
    const imageSize = response.data.Image.Size;
    const tileSize = response.data.Image.TileSize;

    // Compute effective data file size at current zoom level
    const maxZoomLevel = Math.ceil(Math.log2(Math.max(imageSize.Width, imageSize.Height)));

    const zoomLevelFactor = (2 ** (maxZoomLevel - Z + 2));

    const widthAtZoomLevel = imageSize.Width / zoomLevelFactor;
    const heightAtZoomLevel = imageSize.Height / zoomLevelFactor;

    // Compute number of tiles at current zoom level
    const numColumns = (widthAtZoomLevel / tileSize);
    const numRows = (heightAtZoomLevel / tileSize);

    console.log(`width = ${widthAtZoomLevel}, height = ${heightAtZoomLevel}, maxZoomLevel = ${maxZoomLevel}, zoomLevelFactor = ${zoomLevelFactor}, numColumns = ${numColumns}, numRows = ${numRows}`);


    console.log('Look below');
    console.log(2 ** (Math.floor(Math.log2(numColumns))));
    console.log(2 ** (Math.floor(Math.log2(numRows))));
    updateScaleBar(Z);
    //renderColorBar();

    // Select the canvas element from HTML
    const canvas = document.getElementById('myCanvas');

    // Define the canvas size (cx and cy)
    const cx = canvas.width; // 
    const cy = canvas.height; //

    const ctx = canvas.getContext('2d');

    //ctx.clearRect(0, 0, cx, cy);

    // Create a variable to keep track of whether at least one file was successfully loaded
    let atLeastOneFileLoaded = false;   //doubt

    // We need the same color palette for all tiles;
    const minValue = 0.0; //Math.min(...heights);
    const maxValue = 1.0; //Math.max(...heights);

    const colorPalette = Palettes.inferno(20);

    for (let rowIndex = 0; rowIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numRows)))); rowIndex++) {
      for (let columnIndex = 0; columnIndex < Math.max(1, 2 ** (Math.floor(Math.log2(numColumns)))); columnIndex++) {
        const fileName = `${rowIndex}_${columnIndex}.nc`;
        const netcdfUrl = `${baseUrl}${Math.floor(Z)}/${fileName}`;

        console.log(`Trying to load tile at Z=${Z}, row=${rowIndex}, column=${columnIndex}`);


        // Calculate the position for rendering in the canvas
        const xPos = columnIndex * (cx / Math.max(1,(Math.log2(numColumns))));
        console.log(xPos, columnIndex, numColumns);
        const yPos = rowIndex * (cy / Math.max(1,(Math.log2(numRows))));
        const cellWidth = cx / Math.max(1,(Math.log2(numColumns)));
        const cellHeight = cy / Math.max(1,(Math.log2(numRows)));
        //console.log(xPos,yPos, cellWidth, cellHeight);
        axios.get(netcdfUrl, { responseType: 'arraybuffer' })
          .then((response) => response.data)
          .then((data) => {
            const netcdfReader = new NetCDFReader(data);
            const heights = netcdfReader.getDataVariable('heights');

            const ctx = canvas.getContext('2d');

            const dimensions = netcdfReader.dimensions;
            const xDim = dimensions.find((dim) => dim.name === 'y');
            const yDim = dimensions.find((dim) => dim.name === 'x');
            const xSize = xDim.size;
            const ySize = yDim.size;

            console.log(xSize);
            console.log(ySize);

             for (let y = 0; y < ySize; y++) {
                for (let x = 0; x < xSize; x++) {
                  const value = heights[y * xSize + x];
                  const scaledValue = (value - minValue) / (maxValue - minValue);
                  const colorIndex = Math.floor(scaledValue * (colorPalette.length - 1));
                  const color = colorPalette[colorIndex];


                  const cellX = xPos + (x * cellWidth) / xSize;
                  const cellY = yPos + (y * cellHeight) / ySize;
                  const cellColor = '#' + (color.toString(16).substring(0, 6));

                  ctx.fillStyle = cellColor;
                  ctx.fillRect(cellX, cellY, cellWidth / xSize, cellHeight / ySize);
                  //console.log(cellX , cellY , cellWidth, xSize, cellHeight, ySize);


              }
            }



            // Set the flag to true to indicate that at least one file was successfully loaded
            atLeastOneFileLoaded = true;
          })
          .catch((error) => {
            console.error(`Error loading NetCDF file: ${netcdfUrl}`);
            console.error(error);
          });
        }
      }

    // Check if at least one file was successfully loaded before rendering (not working properly)
    if (atLeastOneFileLoaded) {
      // Render the canvas or perform any additional actions
      console.log('Successfully loaded');
    } 
    else {
      // Handle the case where no files were successfully loaded (not working properly)
      console.log('No files were successfully loaded');
    }

    // Display the current Z value in the console
    console.log(`Current Z value: ${Z}`);
  });
}

// Event listener for mouse scroll to control Z value
window.addEventListener('wheel', (event) => {
  if (event.deltaY > 0) {
    // Zoom out
    if (Z > 0) {
      Z = parseFloat((Z - 0.1).toFixed(2));    }
  } else {
    // Zoom in
    if (Z < 10) { // Adjust the maximum Z value
      Z = parseFloat((Z + 0.1).toFixed(2));
    }
  }
   const canvas = document.getElementById('myCanvas');
  const ctx = canvas.getContext('2d');
  const cx = canvas.width;
  const cy = canvas.height;

  // Clear the canvas before updating for the new Z value
  //ctx.clearRect(0, 0, cx, cy);
  updateVisualization(Z);
});

renderColorBar(Palettes.inferno(20));