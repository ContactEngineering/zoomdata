import {Palettes} from '@bokeh/bokehjs';
import { version } from '@bokeh/bokehjs';
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';

// Define the magnification level (Z)
let Z = 9; // 

// Initial visualization
 updateVisualization(Z);

// Loop through each NetCDF file URL
function updateVisualization(Z) {

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


  // Define the number of rows and columns for the matrix
  const numRows = 4;
  const numCols = 4;

  // Create a variable to keep track of whether at least one file was successfully loaded
  let atLeastOneFileLoaded = false;   //doubt

  // Loop through each NetCDF file URL
    // Loop through each NetCDF file URL
  netcdfUrls.forEach((netcdfUrl, index) => {
    // Calculate the row and column indices based on the index in the fileNames array
    const rowIndex = Math.floor(index / numCols);
    const colIndex = index % numCols;

    // Calculate the position for rendering in the canvas
    const xPos = colIndex * (cx / numCols);
    const yPos = rowIndex * (cy / numRows);
    const cellWidth = cx / numCols;
    const cellHeight = cy / numRows;
    axios.get(netcdfUrl, { responseType: 'arraybuffer' })
      .then((response) => response.data)
      .then((data) => {
        const netcdfReader = new NetCDFReader(data);
        const heights = netcdfReader.getDataVariable('heights');

        const minValue = Math.min(...heights);
        const maxValue = Math.max(...heights);

        const colorPalette = Palettes.inferno(20);

        const ctx = canvas.getContext('2d');
        //ctx.clearRect(0, 0, cx, cy);



        const dimensions = netcdfReader.dimensions;
        const xDim = dimensions.find((dim) => dim.name === 'x');
        const yDim = dimensions.find((dim) => dim.name === 'y');
        const ySize = yDim.size;
        const xSize = xDim.size;

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
          }
        }
        ctx.clearRect(0, 0, cx, cy);

        // Set the flag to true to indicate that at least one file was successfully loaded
        atLeastOneFileLoaded = true;
      })
      .catch((error) => {
        console.error(`Error loading NetCDF file: ${netcdfUrl}`);
        console.error(error);
      });
  });

  // Check if at least one file was successfully loaded before rendering (not working properly)
  if (atLeastOneFileLoaded) {
    // Render the canvas or perform any additional actions
    console.log('Successfully loaded');
  } else {
    // Handle the case where no files were successfully loaded (not working properly)
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
    }
  } else {
    // Zoom in
    if (Z < 10) { // Adjust the maximum Z value
      Z++;
    }
  }
  
  updateVisualization(Z);
});

