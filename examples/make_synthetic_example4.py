from SurfaceTopography.Generation import fourier_synthesis

nx, ny = 8192, 8192
t = fourier_synthesis((nx, ny), (1.0, 1.0), 0.8, rms_slope=0.1, unit='mm')
manifest = t.to_dzi('dzdata', 'synthetic_square4', format='nc', meta_format='json')
t.to_netcdf('syn4.nc')
