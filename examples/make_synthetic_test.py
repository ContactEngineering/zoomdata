# import numpy as np
# from SurfaceTopography import Topography
# import matplotlib.pyplot as plt

# mx, my = 8, 8
# nx, ny = 8192, 8192
# x, y = np.mgrid[:nx, :ny]
# h = 0.01*(np.sin(mx*2*np.pi*x/nx) + np.sin(my*2*np.pi*y/ny))
# t = Topography(h, physical_sizes=(1, 1), unit='um')

# # --- pick a crosshair position in physical µm ---
# # same position you double-clicked in the viewer
# crosshair_x_um = 0.53
# crosshair_y_um = 0.36

# # convert to pixel indices
# pixel_x = int(crosshair_x_um / 1.0 * nx)
# pixel_y = int(crosshair_y_um / 1.0 * ny)

# # physical axis arrays (µm)
# x_axis = np.linspace(0, 1, nx, endpoint=False)
# y_axis = np.linspace(0, 1, ny, endpoint=False)

# # horizontal scan: fixed row = pixel_y, walk all columns
# h_scan = h[:, pixel_y]   # shape (nx,)

# # vertical scan: fixed col = pixel_x, walk all rows
# v_scan = h[pixel_x, :]   # shape (ny,)

# fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))

# ax1.plot(x_axis, h_scan)
# ax1.axvline(crosshair_x_um, color='red', linestyle='--')
# ax1.set_xlabel('x position (µm)')
# ax1.set_ylabel('Height (µm)')
# ax1.set_title(f'Horizontal scan at y={crosshair_y_um} µm')

# ax2.plot(v_scan, y_axis)   # flipped axes to match vertical panel orientation
# ax2.axhline(crosshair_y_um, color='red', linestyle='--')
# ax2.set_xlabel('Height (µm)')
# ax2.set_ylabel('y position (µm)')
# ax2.set_title(f'Vertical scan at x={crosshair_x_um} µm')

# plt.tight_layout()
# plt.savefig('linescan_reference.png', dpi=150)
# plt.show()

from scipy.io import netcdf_file
f = netcdf_file('synthetic_square4/dzdata_files/9/1_1.nc', 'r', mmap=False)
x = f.variables['x'].data.copy()
y = f.variables['y'].data.copy()
print("x first:", x[0], "last:", x[-1])
print("y first:", y[0], "last:", y[-1])
f.close()