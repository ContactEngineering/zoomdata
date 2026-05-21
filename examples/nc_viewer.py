import netCDF4 as nc

f = nc.Dataset('synthetic_square4/dzdata_files/10/0_1.nc', 'r')

print("Variables:", list(f.variables.keys()))

for name, var in f.variables.items():
    print(f"\n{name}: shape={var.shape}, dtype={var.dtype}")
    print(f"  values: {var[:]}")

f.close()