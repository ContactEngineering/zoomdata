# Pyramid format

This is the contract between the writer (SurfaceTopography's `write_dzi`
with `format="nc"`, `meta_format="json"`) and the zoomdata reader. The reader
accepts format versions 1 and 2 and rejects any other version.

## Layout

A pyramid is a descriptor and one file per tile:

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
| `Unit`                       | no              | Unit of the height values                                             |
| `Detrend`                    | no              | Detrend mode applied before writing, e.g. `height`, `curvature`       |
| `Downsample`                 | no              | How coarse levels were computed: `mean` or `nearest`                  |
| `Colormap`                   | no              | Colour map name suggested by the writer                               |

SurfaceTopography does not write `Unit` yet; the unit is part of
`ColorbarTitle` and is the `unit` attribute of the tile variables.

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
rejects tiles whose shape does not match. Nothing in it depends on the
overlap being non-zero; the renderer draws only tile cores.

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
