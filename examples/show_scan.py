import glob
import numpy as np
import matplotlib.pyplot as plt
from netCDF4 import Dataset

plt.figure()
for fn in glob.glob("ramp/dzdata_files/9/*_0.nc"):
    nc = Dataset(fn)
    x = np.array(nc.variables['x'])
    h = np.array(nc.variables['heights'])
    plt.plot(x, h[:, 128], '-')
plt.show()
