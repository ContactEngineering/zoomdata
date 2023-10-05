import {Palettes} from '@bokeh/bokehjs';
import { version } from '@bokeh/bokehjs';
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';

// Define the base URL for NetCDF files
const baseFolder = 'http://localhost:8000/test/example_files/synthetic_square/dzdata_files/';
const maxZoomLevel = 9;
const zoomLevel = 2;

if (zoomLevel >= 0 && zoomLevel <= maxZoomLevel) {
  const zoomedFolderUrl = `${baseFolder}${zoomLevel}/`;

  // Make a GET request using Axios to get a list of file names in the folder
  axios.get(zoomedFolderUrl)
    .then((response) => {
      const fileNames = response.data; // Assuming the server returns a list of file names
      console.log(fileNames);
      // Iterate through the file names using a for loop
      for (let i = 0; i < fileNames.length; i++) {
        const fileName = fileNames[i];
        
        // Make a GET request to load each NetCDF file
        axios.get(`${zoomedFolderUrl}${fileName}`, { responseType: 'arraybuffer' })
          .then((response) => response.data)
          .then((data) => {
            const netcdfReader = new NetCDFReader(data);
            const heights = netcdfReader.getDataVariable('heights');

            // Create an HTML canvas element and visualize the data here
            const canvas = document.getElementById("myCanvas");
            const ctx = canvas.getContext("2d");

            const c_width = canvas.width;
            const c_height = canvas.height;
            console.log(heights.length);

            const dimensions = netcdfReader.dimensions;

            const xDim = dimensions.find(dim => dim.name === 'x');
            const yDim = dimensions.find(dim => dim.name === 'y');
            const ySize = yDim.size;
            const xSize = xDim.size;

            console.log(ySize);
            console.log(xSize);

            // Bokeh color map
            const colorPalette = Palettes.inferno(20); 
            const minValue = Math.min(...heights);
            const maxValue = Math.max(...heights);

            for (let y = 0; y < ySize; y++) {
              for (let x = 0; x < xSize; x++) {
                const value = heights[y * xSize + x];
                const scaledValue = (value - minValue) / (maxValue - minValue);
                const colorIndex = Math.floor(scaledValue * (colorPalette.length - 1));
                const color = colorPalette[colorIndex];

                ctx.fillStyle = '#' + (color.toString(16).substring(0, 6));
                ctx.fillRect(x, y, 1, 1);
              }
            }
          });
      }
    })
    .catch((error) => {
      console.error('Error fetching file list:', error);
    });
} else {
  console.error('Invalid zoom level. Zoom level must be between 0 and 9.');
}
