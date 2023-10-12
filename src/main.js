import {Palettes} from '@bokeh/bokehjs';
import { version } from '@bokeh/bokehjs';
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';

// Define the magnification level (Z)
let Z = 2; // 

// Define the constant part of the URL
const baseUrl = 'http://localhost:8000/test/example_files/synthetic_square/dzdata_files/';

// Define the fixed file names
const fileNames = [
  '0_0.nc', '0_1.nc', '0_2.nc', '0_3.nc',
  '1_0.nc', '1_1.nc', '1_2.nc', '1_3.nc',
  '2_0.nc', '2_1.nc', '2_2.nc', '2_3.nc',
  '3_0.nc', '3_1.nc', '3_2.nc', '3_3.nc'
];

// Create an array to store the generated URLs
const netcdfUrls = [];

// Loop through each fixed file name and generate the URL based on Z
for (const fileName of fileNames) {
  const url = `${baseUrl}${Z}/${fileName}`;
  netcdfUrls.push(url);
}

// Select the canvas element from your HTML
const canvas = document.getElementById('myCanvas');

// Define the canvas size (cx and cy)
const cx = canvas.width; // 
const cy = canvas.height; //

// Create a variable to keep track of whether at least one file was successfully loaded
let atLeastOneFileLoaded = false;

// Loop through each NetCDF file URL
function updateVisualization() {
  // Loop through each NetCDF file URL
  netcdfUrls.forEach((netcdfUrl) => {
    // Make a GET request using Axios for each URL
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

        const t = 256; // Define the tile size (t)


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

        // Set the flag to true to indicate that at least one file was successfully loaded
        atLeastOneFileLoaded = true;
      })
      .catch((error) => {
        console.error(`Error loading NetCDF file: ${netcdfUrl}`);
        console.error(error);
      });
  });

  // Check if at least one file was successfully loaded before rendering
  if (atLeastOneFileLoaded) {
    // Render the canvas or perform any additional actions
    console.log('Successfully loaded');
  } else {
    // Handle the case where no files were successfully loaded (e.g., display a message)
    console.log('No files were successfully loaded');
  }

  // Display the current Z value in the console
  console.log(`Current Z value: ${Z}`);
}

// Event listener for mouse scroll to control Z value
window.addEventListener('wheel', (event) => {
  if (event.deltaY > 0) {
    // Zoom out
    if (Z > 0) {
      Z--;
      updateVisualization();
    }
  } else {
    // Zoom in
    if (Z < 10) { // Adjust the maximum Z value as needed
      Z++;
      updateVisualization();
    }
  }
});

// Initial visualization
updateVisualization();