"""Render the georeferenced quicklook the console drapes inside a scene footprint.

From the delivered StriX-3 ORT gamma0 GeoTIFF this writes two things:

    backend/testdata/quicklook/<scene id>.png   grey + alpha, WGS84, north-up
    backend/testdata/scenes.json                the scene's `quicklook` block and its
                                                footprint, updated in place

The rendering is the one notebook 01 arrives at: the float32 gamma0 band (never
the delivered uint8 quicklook, whose values mean nothing in decibels), averaged
down while reading, converted with 10*log10, stretched between the 2nd and 98th
percentile. The one step the notebook does not take is the reprojection from
UTM zone 52N to WGS84. After it the PNG's edges are lines of constant longitude
and latitude, so the frontend places the image with four numbers and nothing
has to know what a UTM zone is.

The footprint is rewritten because the old one was wrong in a way the image
makes visible. The seed carried the axis-aligned extent of the raster, placed on
the scene centre. Only 54 % of that rectangle holds pixels: the imaged swath is
rotated about 12 degrees (the platform heading is 347.74) and the corners are
nodata. The outline written here is the convex hull of the valid pixels, so the
polygon on the map and the picture inside it agree.

Provenance. The output is an 8-bit rendering at roughly one pixel in eight of
the product in each direction, with no radiometric content left in it - the
same kind of derived figure the notebooks already carry. The README's Data
section states the judgement behind publishing it; this script only records
how it was made.

Run from anywhere inside the repository, with the notebook environment:

    .venv/Scripts/python scripts/make_quicklook.py     # Windows
    .venv/bin/python scripts/make_quicklook.py         # Linux, macOS
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio import features
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds
from shapely.geometry import shape
from shapely.geometry.polygon import orient

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "data").is_dir())

SCENE_ID = "STRIX3-20260615T063527Z-SL1"
PRODUCT = (
    ROOT / "data" / "StriX-3_20260615_063527_SL1_202606-00876" / "ORT_Geotiff"
    / "IMG-VV-STRIX3-20260615T063527Z-SLORT-gamma0.tif"
)
CATALOG = ROOT / "backend" / "testdata" / "scenes.json"
OUT_DIR = ROOT / "backend" / "testdata" / "quicklook"

# Output width in pixels. 1400 across a 14.8 km scene is about 10 m per pixel and
# under a megabyte of PNG: enough to read the caldera, the town and the field
# pattern, small enough to load in a second on a phone. Both the map and the
# sheet show it at far fewer pixels than this.
OUT_WIDTH = 1400

# Read the source at about this many pixels on its long side. Finer than the
# output, so the reprojection resamples down rather than up.
READ_LONG_SIDE = 1600

# The stretch notebook 01 uses: a few extreme pixels must not wash out the rest.
PERCENTILES = (2, 98)

# Simplification tolerance for the footprint, in degrees. 0.0005 is about 50 m,
# well under a pixel of what the map draws at any zoom the footprint is visible.
FOOTPRINT_TOLERANCE_DEG = 0.0005


def read_decibels(path: Path):
    """The gamma0 band in dB at reduced size, NaN where there is no data."""
    with rasterio.open(path) as src:
        k = max(1, max(src.width, src.height) // READ_LONG_SIDE)
        band = src.read(
            1,
            out_shape=(src.height // k, src.width // k),
            resampling=Resampling.average,
            masked=True,
        )
        crs, bounds = src.crs, tuple(src.bounds)

    linear = band.filled(np.nan)
    linear[linear <= 0] = np.nan  # log of zero or negative is undefined
    return 10 * np.log10(linear), crs, bounds


def stretch_to_grey(db: np.ndarray):
    """Grey and alpha bands, plus the dB values that became black and white."""
    vmin, vmax = np.nanpercentile(db, PERCENTILES)
    valid = np.isfinite(db)

    grey = np.zeros(db.shape, np.uint8)
    grey[valid] = np.clip((db[valid] - vmin) / (vmax - vmin) * 255, 0, 255).astype(np.uint8)
    alpha = np.where(valid, 255, 0).astype(np.uint8)
    return grey, alpha, float(vmin), float(vmax)


def to_wgs84(grey, alpha, src_crs, src_bounds):
    """Reproject both bands north-up in WGS84. Returns the bands and the edges."""
    west, south, east, north = transform_bounds(src_crs, "EPSG:4326", *src_bounds)
    width = OUT_WIDTH
    height = round(width * (north - south) / (east - west))
    dst_transform = from_bounds(west, south, east, north, width, height)

    h, w = grey.shape
    src_transform = from_bounds(*src_bounds, w, h)

    out = np.zeros((2, height, width), np.uint8)
    for i, (band, resampling) in enumerate(((grey, Resampling.bilinear), (alpha, Resampling.nearest))):
        reproject(
            band, out[i],
            src_transform=src_transform, src_crs=src_crs,
            dst_transform=dst_transform, dst_crs="EPSG:4326",
            resampling=resampling,
        )
    return out[0], out[1], dst_transform, (west, south, east, north)


def valid_footprint(alpha: np.ndarray, transform):
    """Convex hull of the pixels that hold data, as a closed [lon, lat] ring."""
    mask = alpha > 127
    polygons = [
        shape(geometry)
        for geometry, value in features.shapes(mask.astype(np.uint8), mask=mask, transform=transform)
        if value == 1
    ]
    largest = max(polygons, key=lambda g: g.area)
    hull = orient(largest.convex_hull.simplify(FOOTPRINT_TOLERANCE_DEG), sign=1.0)
    return [[round(lon, 6), round(lat, 6)] for lon, lat in hull.exterior.coords]


def update_catalog(footprint, bounds, vmin, vmax, width, height, png_name) -> None:
    """Rewrite the scene's footprint and quicklook block, leaving everything else as it was."""
    document = json.loads(CATALOG.read_text(encoding="utf-8"))
    scenes = document["scenes"]
    index = next(i for i, s in enumerate(scenes) if s["id"] == SCENE_ID)
    old = scenes[index]

    quicklook = {
        "file": f"quicklook/{png_name}",
        "bounds": [round(v, 6) for v in bounds],
        "min_db": round(vmin, 2),
        "max_db": round(vmax, 2),
        "width_px": width,
        "height_px": height,
    }
    note = (
        "Real Synspective sample product over Mt. Aso, Kyushu. Every field above is delivered "
        "metadata read off the product in notebook 01. The footprint is the convex hull of the "
        "valid pixels of the orthorectified gamma0 raster, reprojected from UTM 52N to WGS84 by "
        "scripts/make_quicklook.py, which also renders the quicklook from that raster in decibels "
        "at reduced resolution. NESZ is null because the delivered metadata does not state it."
    )

    # Rebuilt key by key so `quicklook` lands before `note` rather than at the end.
    updated = {}
    for key, value in old.items():
        if key == "footprint":
            updated[key] = footprint
        elif key == "note":
            updated["quicklook"] = quicklook
            updated[key] = note
        else:
            updated[key] = value
    scenes[index] = updated

    CATALOG.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    db, crs, bounds_utm = read_decibels(PRODUCT)
    grey, alpha, vmin, vmax = stretch_to_grey(db)
    grey, alpha, transform, bounds = to_wgs84(grey, alpha, crs, bounds_utm)
    footprint = valid_footprint(alpha, transform)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png_name = f"{SCENE_ID}.png"
    Image.fromarray(np.dstack([grey, alpha]), "LA").save(OUT_DIR / png_name, optimize=True)

    height, width = grey.shape
    update_catalog(footprint, bounds, vmin, vmax, width, height, png_name)

    size_mb = (OUT_DIR / png_name).stat().st_size / 1e6
    print(f"wrote {OUT_DIR / png_name}: {width} x {height} px, {size_mb:.2f} MB")
    print(f"stretch {vmin:.2f} to {vmax:.2f} dB, bounds {tuple(round(b, 6) for b in bounds)}")
    print(f"footprint {len(footprint) - 1} vertices, valid pixels {np.mean(alpha > 127):.1%} of the rectangle")


if __name__ == "__main__":
    main()
