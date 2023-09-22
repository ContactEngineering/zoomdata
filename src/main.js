//import {Palettes} from '@bokeh/bokehjs';
import * as Bokeh from '@bokeh/bokehjs'; 
import axios from 'axios';
import { NetCDFReader } from 'netcdfjs';

// URL of the NetCDF file
    const netcdfUrl = 'http://localhost:8000/test/example_files/synthetic_square/dzdata_files/8/0_0.nc';

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
            
            //console.log(Palettes.viridis(20));
            console.log(Bokeh.version);
          	console.log(heights);

            const canvas = document.getElementById("myCanvas");
            const ctx = canvas.getContext("2d");

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
            const colormap = Bokeh.Palettes.Viridis;

            for (let y = 0; y < ySize; y++) {
              for (let x = 0; x < xSize; x++) {
                const value = heights[y * xSize + x];
                const colorIndex = Math.floor((value * (colormap.length - 1))); // Map value to color index
                const color = colormap[colorIndex];
                ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
                ctx.fillRect(x, y, 1, 1);
              }
            }
      });







// http://www.unidata.ucar.edu/software/netcdf/examples/files.html
//let reader = new FileReader();
//const data = reader.readAsArrayBuffer("http://localhost:8000/test/example_files/synthetic_square/dzdata_files/0/0_0.nc");

//var netcdfReader = new NetCDFReader(data); // read the header
//netcdfReader.getDataVariable("wmoId"); // go to offset and read it
