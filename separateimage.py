import numpy as np
import matplotlib.cm as cm
from PIL import Image
from scipy.io.netcdf import netcdf_file
import os

# List of NetCDF files to convert
netcdf_files = ['/home/naira/zoomdata/zoomdata/test/example_files/synthetic_square/dzdata_files/6/0_0.nc']


for filename in netcdf_files:
    f = netcdf_file(filename)
    variable = f.variables['heights']
    data = np.array(variable[:], dtype=float)  # Explicitly convert to NumPy array
    colormap = cm.inferno(data)

    colors = (cm.inferno(data) * 255).astype(np.uint8)


    image = Image.fromarray(colors[:, :, :3])
    png_filename = filename.replace('.nc', '.png')
    image.save(png_filename)
    # Optional: Rotate the image if necessary (append .T)
    print(f"Saved PNG file: {os.path.abspath(png_filename)}")

print("End of script") 