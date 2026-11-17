"""
Generate the tile pyramids used by the render and decoder tests.

The pyramids are written by SurfaceTopography's `write_dzi`, as NetCDF
tiles, and by its `write_zarr_pyramid`, as a zipped OME-Zarr `pyramid.ozx`.
Next to each pyramid, `reference/` holds the expected data of every level,
computed here independently of the writers:

- `reference/levels.json` lists, per level, its shape and the byte offset of
  its data in `reference/levels.f64`;
- `reference/levels.f64` holds the levels as little-endian float64 in
  row-major (y, x) order, in physical units, with NaN for undefined points.

A level with stride s = 2**(max_level - level) holds at pixel (i, j) the mean
of the defined points of the image block [i*s, (i+1)*s) x [j*s, (j+1)*s)
(truncated at the image boundary), or NaN if the block has none.

The script also checks every tile and every Zarr level against the
reference, so it doubles as a test of the writers. Rerun it after changing
the fixtures:

    python test/fixtures/generate.py

It needs SurfaceTopography with `write_zarr_pyramid` (after v1.28.0) and
zarr.
"""

import json
import math
import os
import shutil
import sys

import numpy as np
import zarr
from scipy.io import netcdf_file
from SurfaceTopography import __version__ as st_version
from SurfaceTopography.IO.DZI import write_dzi
from SurfaceTopography.IO.ZarrPyramid import write_zarr_pyramid

HERE = os.path.dirname(os.path.abspath(__file__))


def pattern(nx, ny):
    """High-contrast pattern: neighbours differ, tiles differ by a ramp"""
    x, y = np.mgrid[:nx, :ny]
    return 0.7 * ((3 * x + 7 * y) % 16) / 15 + 0.3 * (0.6 * x / nx + 0.4 * y / ny)


def disc_mask(nx, ny, cx, cy, r):
    x, y = np.mgrid[:nx, :ny]
    return (x - cx) ** 2 + (y - cy) ** 2 < r**2


FIXTURES = {
    # Image size is not a multiple of the tile size
    "pattern-ov1": dict(shape=(150, 100), tile_size=32, overlap=1, nc_version=1),
    "pattern-ov0": dict(shape=(150, 100), tile_size=32, overlap=0, nc_version=1),
    "pattern-ov2": dict(shape=(130, 70), tile_size=32, overlap=2, nc_version=1),
    # Large offset compared to the range, and a hole of undefined points
    "nan-v2": dict(
        shape=(150, 100),
        tile_size=32,
        overlap=1,
        nc_version=2,
        offset=1000.0,
        mask=(40, 60, 18),
    ),
    "nan-v1": dict(
        shape=(150, 100), tile_size=32, overlap=1, nc_version=1, mask=(40, 60, 18)
    ),
    # Constant map: scale_factor = 1
    "flat-v2": dict(shape=(40, 30), tile_size=16, overlap=1, nc_version=2, flat=True),
}


def reference_levels(heights):
    """Mean of the defined points of each block, for every level"""
    nx, ny = heights.shape
    max_level = math.ceil(math.log2(max(nx, ny)))
    defined = np.isfinite(heights)
    levels = {}
    for level in range(max_level, -1, -1):
        s = 2 ** (max_level - level)
        mx, my = math.ceil(nx / s), math.ceil(ny / s)
        sums = np.zeros((mx, my))
        counts = np.zeros((mx, my))
        for i in range(mx):
            for j in range(my):
                block = heights[i * s : (i + 1) * s, j * s : (j + 1) * s]
                d = defined[i * s : (i + 1) * s, j * s : (j + 1) * s]
                sums[i, j] = block[d].sum()
                counts[i, j] = d.sum()
        with np.errstate(invalid="ignore"):
            levels[level] = np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
    return max_level, levels


def check_tiles(root, descriptor, max_level, levels):
    """Every tile must be the overlapped slice of its reference level"""
    image = descriptor["Image"]
    tile_size, overlap = image["TileSize"], image["Overlap"]
    mn, mx = image["ColorbarRange"]["Minimum"], image["ColorbarRange"]["Maximum"]
    for level, ref in levels.items():
        nx, ny = ref.shape
        for col in range(math.ceil(nx / tile_size)):
            for row in range(math.ceil(ny / tile_size)):
                fn = os.path.join(root, "dzdata_files", str(level), f"{col}_{row}.nc")
                with netcdf_file(fn, "r", mmap=False) as nc:
                    var = nc.variables["heights"]
                    v = np.array(var[...], dtype=float)
                    if image.get("FormatVersion", 1) == 2:
                        h = var.add_offset + var.scale_factor * v
                    else:
                        h = mn + (mx - mn) * v
                x0 = max(col * tile_size - overlap, 0)
                y0 = max(row * tile_size - overlap, 0)
                x1 = min((col + 1) * tile_size + overlap, nx)
                y1 = min((row + 1) * tile_size + overlap, ny)
                expected = ref[x0:x1, y0:y1]
                assert h.shape == expected.shape, (fn, h.shape, expected.shape)
                np.testing.assert_allclose(h, expected, rtol=1e-6, atol=1e-6 * (mx - mn))
                assert np.array_equal(np.isnan(h), np.isnan(expected)), fn


def check_zarr(fn, max_level, levels):
    """Every level of the Zarr pyramid must be its reference level"""
    with zarr.storage.ZipStore(fn, mode="r") as store:
        root = zarr.open_group(store, mode="r")
        datasets = root.attrs["ome"]["multiscales"][0]["datasets"]
        for k, dataset in enumerate(datasets):
            array = root[dataset["path"]]
            h = array.attrs["add_offset"] + array.attrs["scale_factor"] * array[...].astype(float)
            expected = levels[max_level - k].T
            assert h.shape == expected.shape, (fn, k, h.shape, expected.shape)
            span = np.nanmax(expected) - np.nanmin(expected)
            np.testing.assert_allclose(h, expected, rtol=0, atol=1e-6 * max(span, 1))
            assert np.array_equal(np.isnan(h), np.isnan(expected)), (fn, k)
        # The coarsest level is a single chunk
        assert max(array.shape) <= array.chunks[0], fn


def generate(name, shape, tile_size, overlap, nc_version, offset=0.0, mask=None, flat=False):
    nx, ny = shape
    heights = np.full(shape, 0.25) if flat else pattern(nx, ny) + offset
    if mask is not None:
        heights = np.ma.masked_array(heights, mask=disc_mask(nx, ny, *mask))

    root = os.path.join(HERE, name)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    write_dzi(
        heights,
        "dzdata",
        physical_sizes=(nx * 0.5, ny * 0.5),
        unit="um",
        root_directory=root,
        tile_size=tile_size,
        overlap=overlap,
        format="nc",
        meta_format="json",
        colorbar_title="Height (µm)",
        nc_version=nc_version,
    )
    with open(os.path.join(root, "dzdata.json")) as f:
        descriptor = json.load(f)

    max_level, levels = reference_levels(np.ma.filled(np.ma.asarray(heights, float), np.nan))
    check_tiles(root, descriptor, max_level, levels)

    # The same data as a zipped OME-Zarr; tiles get their overlap when read
    zarr_fn = os.path.join(root, "pyramid.ozx")
    write_zarr_pyramid(
        heights,
        zarr_fn,
        physical_sizes=(nx * 0.5, ny * 0.5),
        unit="um",
        tile_size=tile_size,
        shard_tiles=2,
        colorbar_title="Height (µm)",
    )
    check_zarr(zarr_fn, max_level, levels)

    ref_root = os.path.join(root, "reference")
    os.makedirs(ref_root)
    index = {"maxLevel": max_level, "levels": {}}
    offset_bytes = 0
    with open(os.path.join(ref_root, "levels.f64"), "wb") as f:
        for level in range(max_level + 1):
            # Row-major (y, x), as the viewer holds tiles in memory
            a = np.ascontiguousarray(levels[level].T, dtype="<f8")
            f.write(a.tobytes())
            index["levels"][level] = {
                "width": a.shape[1],
                "height": a.shape[0],
                "offset": offset_bytes,
            }
            offset_bytes += a.nbytes
    with open(os.path.join(ref_root, "levels.json"), "w") as f:
        json.dump(index, f, indent=1)


def generate_zarr_noise():
    """
    Zarr pyramid of noise, larger than the 64 KiB that unzipit reads from the
    end of the file, for tests of the range requests of the Zarr reader
    """
    root = os.path.join(HERE, "noise-zarr")
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    nx, ny = 200, 160
    heights = np.random.default_rng(42).standard_normal((nx, ny))
    fn = os.path.join(root, "pyramid.ozx")
    write_zarr_pyramid(
        heights, fn, physical_sizes=(nx * 0.5, ny * 0.5), unit="um", tile_size=32, shard_tiles=2
    )
    max_level, levels = reference_levels(heights)
    check_zarr(fn, max_level, levels)
    assert os.path.getsize(fn) > 2 * 65536, os.path.getsize(fn)


def generate_decoder_fixtures():
    """Small NetCDF files for the decoder's special and error cases"""
    root = os.path.join(HERE, "decoder")
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    # 3 x 2 tile with h[x, y] = 10 * x + y
    h = 10.0 * np.arange(3)[:, None] + np.arange(2)[None, :]

    def write(name, dims=("x", "y"), data=h, dtype="f4", version=1, attrs=None, record=False):
        with netcdf_file(os.path.join(root, name), "w", version=version) as nc:
            for d, n in zip(dims, data.shape):
                nc.createDimension(d, None if record and d == dims[0] else n)
            var = nc.createVariable("heights", dtype, dims)
            if record:
                var[: data.shape[0]] = data
            else:
                var[...] = data
            for k, v in (attrs or {}).items():
                setattr(var, k, v)

    # 64-bit offset variant with CF attributes
    write(
        "offset64.nc",
        version=2,
        attrs={"scale_factor": np.float64(2.0), "add_offset": np.float64(-1.0)},
    )
    # Stored as (y, x)
    write("yx.nc", dims=("y", "x"), data=h.T.copy(), dtype="f8")
    write("int.nc", dtype="i4", data=h.astype(np.int32))
    write("dims.nc", dims=("a", "b"))
    write("record.nc", record=True)
    with netcdf_file(os.path.join(root, "no-heights.nc"), "w") as nc:
        nc.createDimension("x", 3)
        v = nc.createVariable("z", "f4", ("x",))
        v[...] = 0


if __name__ == "__main__":
    names = sys.argv[1:] or FIXTURES
    for name in names:
        generate(name, **FIXTURES[name])
        print(f"{name}: ok")
    generate_decoder_fixtures()
    generate_zarr_noise()
    with open(os.path.join(HERE, "GENERATOR"), "w") as f:
        f.write(f"SurfaceTopography {st_version}\n")
