import numpy as np
from SurfaceTopography import Topography

nx, ny = 8192, 8192
x, y = np.mgrid[:nx, :ny]

# Perfect ramp: value increases linearly left to right
h = x / nx  # normalized 0..1

t = Topography(h, physical_sizes=(1e-3, 1e-3), unit='m')
manifest = t.to_dzi('dzdata', 'ramp', format='nc', meta_format='json')