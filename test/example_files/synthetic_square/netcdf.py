from matplotlib import cm
import numpy as np
from PIL import Image
from scipy.io.netcdf import netcdf_file
import os

# List of NetCDF files to convert
netcdf_files = ['/home/aditya/zoomdata/test/example_files/synthetic_square/dzdata_files/9/0_0.nc', '/home/aditya/zoomdata/test/example_files/synthetic_square/dzdata_files/9/0_1.nc', '/home/aditya/zoomdata/test/example_files/synthetic_square/dzdata_files/9/1_0.nc', '/home/aditya/zoomdata/test/example_files/synthetic_square/dzdata_files/9/1_1.nc']

# Loop through each NetCDF file
for filename in netcdf_files:
    f = netcdf_file(filename)
    variable = f.variables['heights']
    data = np.array(variable[:], dtype=float)  # Explicitly convert to NumPy array
    colormap = cm.viridis(data)
    # Convert colormap data to integers (0-255)
    colors = (cm.viridis(data) * 255).astype(np.uint8)
    
    # Create a PIL image from the RGB channels
    image = Image.fromarray(colors[:, :, :3])
    png_filename = filename.replace('.nc', '.png')
    image.save(png_filename)
    # Optional: Rotate the image if necessary (append .T)
    print(f"Saved PNG file: {os.path.abspath(png_filename)}")

print("End of script") 