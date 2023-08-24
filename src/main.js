import { NetCDFReader } from 'netcdfjs';

// http://www.unidata.ucar.edu/software/netcdf/examples/files.html
let reader = new FileReader();
const data = reader.readAsArrayBuffer("madis-sao.nc");

var netcdfReader = new NetCDFReader(data); // read the header
netcdfReader.getDataVariable("wmoId"); // go to offset and read it
