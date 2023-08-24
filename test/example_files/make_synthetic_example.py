from SurfaceTopography.Generation import fourier_synthesis

nx, ny = 1024, 1024
t = fourier_synthesis((nx, ny), (1.0, 1.0), 0.8, rms_slope=0.1, unit='mm')
manifest = t.to_dzi('dzdata', 'synthetic_square', format='nc', meta_format='json')
