"""
Create the data for the demo application.

The demo surface is an egg-box pattern (a product of two sinusoids) with
self-affine roughness on top. The roughness lives on scales well below the
period of the egg box and is small compared to its amplitude, so the
overview shows only the egg box, while the roughness appears when zooming
in. A few circular patches of undefined points show how missing data is
drawn.

The pyramid is written with SurfaceTopography to `demo/data/<name>`, which
the demo's dev server serves at `/data/` and git ignores, and is listed in
`demo/data/datasets.json`, from which the demo fills its dataset menu. Run it again with other parameters and another `--name` to add
datasets:

    python demo/make_demo_data.py
    python demo/make_demo_data.py --name eggbox-8k --size 8192

It needs SurfaceTopography with NetCDF tile format version 2 (v1.28.0 or
later). The default map of 4096 x 4096 points takes about 90 MB.
"""

import argparse
import json
import os
import shutil

import numpy as np
from SurfaceTopography import Topography
from SurfaceTopography.Generation import fourier_synthesis

HERE = os.path.dirname(os.path.abspath(__file__))


def eggbox_with_roughness(size, length, periods, amplitude, roughness, hurst, holes, seed):
    """
    Heights of an egg box with roughness, in units of `length`

    Parameters
    ----------
    size : int
        Number of grid points in each direction.
    length : float
        Physical size in each direction.
    periods : int
        Number of periods of the egg box in each direction.
    amplitude : float
        Amplitude of the egg box; its heights span [-amplitude, amplitude].
    roughness : float
        Root-mean-square height of the roughness, as a fraction of the
        amplitude.
    hurst : float
        Hurst exponent of the roughness.
    holes : int
        Number of circular patches of undefined points.
    seed : int
        Seed of the random number generator.
    """
    rng = np.random.default_rng(seed)
    period = length / periods
    x = np.arange(size) * length / size
    wave = np.sin(2 * np.pi * x / period)
    heights = amplitude / 2 * (wave[:, None] + wave[None, :])

    if roughness > 0:
        # Self-affine below 1/32 of the period, flat above: the
        # roughness has no structure on the scale of the egg box, and
        # averaging over the blocks of coarse levels removes most of it
        heights += fourier_synthesis(
            (size, size),
            (length, length),
            hurst,
            rms_height=roughness * amplitude,
            long_cutoff=period / 32,
            rng=rng,
        ).heights()

    mask = np.zeros((size, size), dtype=bool)
    i = np.arange(size)
    for _ in range(holes):
        cx, cy = rng.uniform(0.15, 0.85, 2) * size
        radius = rng.uniform(0.004, 0.012) * size
        mask |= (i[:, None] - cx) ** 2 + (i[None, :] - cy) ** 2 < radius**2
    return np.ma.masked_array(heights, mask=mask)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--name", default="eggbox", help="name of the dataset")
    parser.add_argument("--size", type=int, default=4096, help="grid points per direction")
    parser.add_argument("--length", type=float, default=100.0, help="physical size in µm")
    parser.add_argument("--periods", type=int, default=8, help="periods of the egg box")
    parser.add_argument("--amplitude", type=float, default=1.0, help="amplitude in µm")
    parser.add_argument(
        "--roughness",
        type=float,
        default=0.04,
        help="rms height of the roughness as a fraction of the amplitude",
    )
    parser.add_argument("--hurst", type=float, default=0.6, help="Hurst exponent")
    parser.add_argument("--holes", type=int, default=3, help="patches of undefined points")
    parser.add_argument("--tile-size", type=int, default=256)
    parser.add_argument("--overlap", type=int, default=1)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--output",
        default=os.path.join(HERE, "data"),
        help="directory that holds the datasets",
    )
    args = parser.parse_args()

    heights = eggbox_with_roughness(
        args.size,
        args.length,
        args.periods,
        args.amplitude,
        args.roughness,
        args.hurst,
        args.holes,
        args.seed,
    )
    topography = Topography(heights, (args.length, args.length), unit="um")

    root = os.path.join(args.output, args.name)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    manifest = topography.to_dzi(
        "dzdata",
        root,
        tile_size=args.tile_size,
        overlap=args.overlap,
        format="nc",
        meta_format="json",
        nc_version=2,
    )
    nbytes = sum(os.path.getsize(fn) for fn in manifest)

    # List the dataset for the demo's menu, keeping the other datasets
    index_fn = os.path.join(args.output, "datasets.json")
    datasets = []
    if os.path.exists(index_fn):
        with open(index_fn) as f:
            datasets = [d for d in json.load(f) if d["name"] != args.name]
    period = args.length / args.periods
    datasets.append(
        {
            "name": args.name,
            "title": f"Egg box with roughness, {args.size} × {args.size}",
            "description": (
                f"{args.length:g} µm wide, period {period:g} µm, "
                f"amplitude {args.amplitude:g} µm, roughness "
                f"{1000 * args.roughness * args.amplitude:g} nm rms"
            ),
            "url": f"data/{args.name}/",
        }
    )
    datasets.sort(key=lambda d: d["name"])
    with open(index_fn, "w") as f:
        json.dump(datasets, f, indent=1)

    print(f"{root}: {len(manifest) - 1} tiles, {nbytes / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
