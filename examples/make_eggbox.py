import numpy as np
from SurfaceTopography import Topography

mx, my = 8, 8
nx, ny = 8192, 8192

x, y = np.mgrid[:nx, :ny]
h = 0.01*(np.sin(mx*2*np.pi*x/nx) + np.sin(my*2*np.pi*y/ny))

t = Topography(h, physical_sizes=(1, 1), unit='um')
manifest = t.to_dzi('dzdata', 'eggbox', format='nc', meta_format='json')
t.to_netcdf('eggbox.nc')
