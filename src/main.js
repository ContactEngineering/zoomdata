import {Palettes} from '@bokeh/bokehjs';
import { version } from '@bokeh/bokehjs';
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';


// URL of the NetCDF file
    const netcdfUrl = 'http://localhost:8000/test/example_files/synthetic_square/dzdata_files/7/0_0.nc';

    // Make a GET request using Axios
    axios.get(netcdfUrl, { responseType: 'arraybuffer' })
      .then((response) => response.data)
      .then((data) => {
            const netcdfReader = new NetCDFReader(data);
            const heights = netcdfReader.getDataVariable('heights');

            //let allHeights = [];

            //for (let i = 0; i < heights.length; i++) {
            //  allHeights.push(heights[i]);
            //  console.log(i)
            
            console.log(Palettes.viridis(20));
          	console.log(heights);

            const canvas = document.getElementById("myCanvas");
            const ctx = canvas.getContext("2d");

            console.log(canvas.height);
            console.log(canvas.width);

            const c_width = canvas.width;
            const c_height = canvas.height;
            console.log(heights.length);

            const dimensions = netcdfReader.dimensions;

            const xDim = dimensions.find(dim => dim.name === 'x');
            const yDim = dimensions.find(dim => dim.name === 'y');
            //console.log(xDim);
            const ySize = yDim.size;
            const xSize = xDim.size;
            //console.log(`x dimension size: ${xSize}`);


            console.log(ySize);
            console.log(xSize);


            // greyscale without bokeh

            //for (let y = 0; y < ySize; y++) {
            //  for (let x = 0; x < xSize; x++) {
            //    const value = heights[y * ySize + x];  
            //    const grayscaleValue = Math.floor((value * 255)); // need to adjust based on data range
            //    ctx.fillStyle = `rgb(${grayscaleValue}, ${grayscaleValue}, ${grayscaleValue})`;
            //    ctx.fillRect(x, y, 1, 1);
            //  }
            //}


            // Bokeh color map
            const colorPalette = Palettes.inferno(20); 
            // Defining a color scale function
            const minValue = Math.min(...heights);
            const maxValue = Math.max(...heights);

            const imageData = ctx.createImageData(xSize, ySize);

            for (let y = 0; y < ySize; y++) {
              for (let x = 0; x < xSize; x++) {
                const value = heights[y * xSize + x];
                const scaledValue = (value - minValue) / (maxValue - minValue);
                const colorIndex = Math.floor(scaledValue * (colorPalette.length - 1));
                const color = colorPalette[colorIndex];


                const htmlColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`;
                
                // Calculate the pixel index in the ImageData data array
                const pixelIndex = (y * xSize + x) * 4; // RGBA format

                // Set the RGBA values in the ImageData
                imageData.data[pixelIndex] = color[0];     // Red
                imageData.data[pixelIndex + 1] = color[1]; // Green
                imageData.data[pixelIndex + 2] = color[2]; // Blue
                imageData.data[pixelIndex + 3] = 255;      // Alpha (fully opaque)
              }
            }

            // Draw the ImageData onto the canvas
            ctx.putImageData(imageData, 0, 0);
          });
