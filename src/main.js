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

            console.log(`minValue: ${minValue}, maxValue: ${maxValue}`);

            //let scaledValue;

            console.log(c_height);
            console.log(c_width);

            for (let y = 0; y < ySize; y++) {
              for (let x = 0; x < xSize; x++) {
                const value = heights[y * xSize + x];
                const scaledValue = (value - minValue) / (maxValue - minValue);
                const colorIndex = Math.floor(scaledValue * (colorPalette.length - 1));
                const color = colorPalette[colorIndex];

                //console.log(`x: ${x}, y: ${y}, value: ${value}, scaledValue: ${scaledValue}, color: ${color}`);
                
                //ctx.fillStyle = color;
                ctx.fillStyle = '#'+(color.toString(16).substring(0, 6));

                ctx.fillRect(x, y, 1, 1);
              }
            }
      });







// http://www.unidata.ucar.edu/software/netcdf/examples/files.html
//let reader = new FileReader();
//const data = reader.readAsArrayBuffer("http://localhost:8000/test/example_files/synthetic_square/dzdata_files/0/0_0.nc");

//var netcdfReader = new NetCDFReader(data); // read the header
//netcdfReader.getDataVariable("wmoId"); // go to offset and read it
