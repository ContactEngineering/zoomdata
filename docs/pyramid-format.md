# Pyramid format

This is the contract between the writers in SurfaceTopography and the
zoomdata reader. A pyramid is stored in one of two ways:

- as a single zipped OME-Zarr file (`.ozx`), written by `to_zarr_pyramid`
  (or `write_zarr_pyramid`), see [Zipped OME-Zarr](#zipped-ome-zarr);
- as a descriptor and one NetCDF file per tile, written by `write_dzi` with
  `format="nc"`, `meta_format="json"`. The reader accepts NetCDF format
  versions 1 and 2 and rejects any other version.

Both share the [geometry](#geometry) of levels and tiles.

## Layout

A NetCDF pyramid is a descriptor and one file per tile:

```
<root>/dzdata.json
<root>/dzdata_files/<level>/<col>_<row>.nc
```

This layout is what `StaticTileSource` implements. Other sources may store
tiles elsewhere; the reader addresses tiles only by level, column and row
(see `TileSource`).

## Descriptor

`dzdata.json` holds a single object `Image` with these fields:

| Field                        | Required        | Meaning                                                               |
| ---------------------------- | --------------- | --------------------------------------------------------------------- |
| `Size.Width`, `Size.Height`  | yes             | Image size in pixels (x, y)                                           |
| `TileSize`                   | yes             | Tile size in pixels, without overlap                                  |
| `Overlap`                    | no (0)          | Tile overlap in pixels, any non-negative integer                      |
| `Format`                     | no              | Tile format; must be `nc` if present                                  |
| `FormatVersion`              | no (1)          | Tile format version, 1 or 2                                           |
| `ColorbarRange`              | v1: yes         | `Minimum` and `Maximum` of the defined height values                  |
| `Encoding`                   | v2: yes         | `ScaleFactor` and `AddOffset` of the tile values (see below)          |
| `ColorbarTitle`              | no              | Axis title, e.g. `Height (µm)`                                        |
| `PixelsPerMeter`             | no              | `Width` and `Height`: pixels per metre along x and y, the pixel size  |
| `Unit`                       | no              | Length unit of the height values, e.g. `nm`, `um`                      |
| `Detrend`                    | no              | Detrend mode applied before writing, e.g. `height`, `curvature`       |
| `Downsample`                 | no              | How coarse levels were computed: `mean` or `nearest`                  |
| `Colormap`                   | no              | Colour map name suggested by the writer                               |

Pyramids written before SurfaceTopography recorded `Unit` do not have it;
the reader then takes the unit from the `unit` attribute of `heights` in the
tiles. With the unit and `PixelsPerMeter`, the reader knows heights and
lateral distances in the same unit, which relief shading needs to compute
slopes. Units are spelled as SurfaceTopography writes them: `m`, `mm`, `um`
(or `µm`), `nm`, `A` (or `Å`), `pm` and so on.

## Geometry

Let `W` x `H` be the image size, `T` the tile size and `o` the overlap.

- The finest level is `maxLevel = ceil(log2(max(W, H)))`; level 0 is a single
  pixel.
- Level `l` has stride `s = 2^(maxLevel - l)`. It is `ceil(W / s)` x
  `ceil(H / s)` pixels; its pixel `i` stands for the image pixels
  `[i*s, (i+1)*s)`, truncated at the image boundary.
- With `Downsample: mean` a coarse pixel holds the mean of the defined
  points of its block, and is undefined if the block has none. With
  `nearest` it holds the image pixel `i*s`. Either way it is located at the
  first point of its block.
- Each level is cut into `ceil(width / T)` x `ceil(height / T)` tiles. Tile
  `(col, row)` is responsible for the level pixels
  `[col*T, (col+1)*T) x [row*T, (row+1)*T)` (its core, truncated at the
  level boundary) and stores the core extended by `o` pixels on every side,
  clipped to the level. Edge tiles are therefore smaller.

The reader computes all of this from the descriptor (`PyramidGeometry`) and
rejects tiles whose shape does not match. It works for any overlap,
including 0, and the plain view draws only tile cores.

An overlap of at least 1 is recommended: relief shading and the tilted view
use the values just outside a tile's core, to compute slopes at its border
and to join the surfaces of adjacent tiles. With an overlap of 0 the map
still shows, with one-sided slopes and small steps at tile borders.

## Tiles

Tiles are NetCDF-3 files (classic or 64-bit offset variant, no record
dimension) with

- dimensions `x` and `y`, the tile's extent along x and y;
- `heights(x, y)`: the height values, x varying slowest (the reader also
  accepts `heights(y, x)`);
- optional coordinate variables `x(x)` and `y(y)` (float64): the physical
  position of each pixel, `offset + index * pixel size`.

The reader holds tiles in memory row-major in (y, x), so that x is
horizontal on screen and y points down.

Undefined (masked) points are NaN in both versions.

### Version 1

`heights` is float64, normalised to `[0, 1]`:
`v = (h - Minimum) / (Maximum - Minimum)` with the `ColorbarRange` of the
descriptor. A constant map has `Maximum - Minimum = 0` and is stored with
scale 1, i.e. `v = h - Minimum = 0`.

### Version 2

`heights` is float32 with `v = (h - add_offset) / scale_factor`, where
`add_offset` is the middle of the height range and `scale_factor` its width,
so `v` lies in `[-0.5, 0.5]`. This spends the float32 mantissa on the data's
range rather than on its offset from zero. `scale_factor` and `add_offset`
are float64 attributes of `heights` in every tile (CF convention) and are
repeated as `Encoding` in the descriptor. A constant map has
`scale_factor = 1`.

### Reading values

The reader keeps the stored values `v` (as float32) and reconstructs
physical values in double precision as `h = add_offset + scale_factor * v`,
taking `scale_factor` and `add_offset` from the tile's attributes, else from
the descriptor (`Encoding` for version 2, `ColorbarRange` for version 1).
All values the reader exposes are in physical units, for both versions.

## Zipped OME-Zarr

The file is a ZIP archive of a [Zarr v3](https://zarr-specs.readthedocs.io/)
hierarchy with [OME-Zarr 0.5](https://ngff.openmicroscopy.org/0.5/)
multiscales metadata, laid out as
[RFC-9](https://ngff.openmicroscopy.org/rfc/9/) recommends: entries are not
compressed by the ZIP, the root `zarr.json` comes first, followed by the
`zarr.json` of every level and then the data. A reader therefore finds all
metadata at the start of the file, and the ZIP's central directory at its
end.

```
zarr.json          root group: attributes "ome" and "zoomdata"
0/zarr.json        full resolution
1/zarr.json        every further level halves the resolution
...
0/c/<j>/<i>        shards of level 0
...
```

### Levels

The array at path `k` (the `k`-th dataset of the multiscales) is level
`maxLevel - k` of the [geometry](#geometry): array `0` is the full
resolution, `W` x `H` pixels, and array `k` is `ceil(W / 2^k)` x
`ceil(H / 2^k)` pixels. The arrays stop at the first level that fits into
a single chunk, which is the base level of the geometry; the reader does
not draw coarser levels.

Each array

- has shape `(H_k, W_k)` and dimension names `(y, x)`, i.e. x varies
  fastest, as the reader holds tiles in memory;
- is float32 (float64 is accepted), with fill value NaN for undefined
  points; chunks and shards without defined points need not be stored;
- has square chunks of `T` x `T` pixels, the tile size, the same for all
  levels. Chunks may be grouped into shards (`sharding_indexed` codec);
  any codecs zarrita reads are accepted.
- carries the CF attributes `scale_factor` and `add_offset`, which turn
  stored values `v` into physical values `h = add_offset + scale_factor * v`
  (default 1 and 0), and `units`, the unit of the heights.

Chunks do not overlap. The reader cuts tiles of the geometry out of the
level, extended by the overlap it is configured with (default 1), from the
neighbouring chunks.

### Root attributes

`ome.multiscales[0]` must have the axes `y` and `x`, in this order. The
`scale` transformation of the first dataset is the pixel size along y and
x, in the unit of the axes (UDUNITS-2 names, e.g. `micrometer`). Translations
are ignored; the reader locates a coarse pixel at the first point of its
block, as in the [geometry](#geometry).

`zoomdata` holds what the viewer needs beyond that, all fields optional:

| Field           | Meaning                                                         |
| --------------- | --------------------------------------------------------------- |
| `version`       | Version of these attributes; the reader accepts 1 (default)     |
| `unit`          | Unit of the heights, spelled as SurfaceTopography writes it     |
| `colorbarRange` | `minimum` and `maximum` of the defined physical values          |
| `colorbarTitle` | Axis title, e.g. `Height (µm)`                                  |
| `colormap`      | Colour map name suggested by the writer                         |
| `detrend`       | Detrend mode applied before writing, e.g. `height`, `curvature` |
| `downsample`    | How coarse levels were computed: `mean` or `nearest`            |

Without `unit`, the reader takes the `units` attribute of array `0`, then
the unit of the axes.

### Reading over HTTP

The reader fetches the first 64 KiB of the file, which holds the metadata,
and the last 64 KiB, which holds the central directory; then every chunk
with a range request of its own, adjacent ones merged. Requests after the
first carry `If-Match` with the file's ETag, so a file replaced on the
server fails instead of mixing two versions. The server must answer range
requests and, for cross-origin requests, expose `Content-Range` and `ETag`.
