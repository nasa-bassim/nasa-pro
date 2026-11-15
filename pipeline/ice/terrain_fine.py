"""Build a fixed 0.1 degree horizon using a local 5m DEM plus a far-field 240m DEM.

Run from root with the optional rasterio/numpy/pyproj environment:
 PYTHONPATH=pipeline/src pipeline/ice/.venv/bin/python pipeline/ice/terrain_fine.py
Only SR1 center changes; neighbour profiles keep their original resolution.
"""

import json
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "pipeline/cache/lola"
R = 1737400.0


def main():
    path = ROOT / "web/public/horizon/sr1.json"
    doc = json.loads(path.read_text())
    lat, lon = doc["lat"], doc["lon_e"]
    with rasterio.open(CACHE / "site04-5m.tif") as src:
        fine = src.read(1, masked=True).astype("float64").filled(np.nan)
        inverse = ~src.transform
        crs = CRS(src.crs)
        project = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
        scale = abs(src.transform.a)
    base = np.fromfile(CACHE / "ldem_75s_240m.img", dtype="<i2").reshape(3812, 3812) * 0.5

    def bilinear(grid, row, col):
        row, col = np.broadcast_arrays(np.asarray(row), np.asarray(col))
        ok = (row >= 0) & (col >= 0) & (row < grid.shape[0] - 1) & (col < grid.shape[1] - 1)
        r = np.clip(row.astype(int), 0, grid.shape[0] - 2)
        c = np.clip(col.astype(int), 0, grid.shape[1] - 2)
        fr, fc = row - r, col - c
        result = (grid[r, c] * (1 - fc) + grid[r, c + 1] * fc) * (1 - fr) + (
            grid[r + 1, c] * (1 - fc) + grid[r + 1, c + 1] * fc
        ) * fr
        return np.where(ok, result, np.nan)

    def height(x, y, z):
        k = 2 * R / (1 - z) / 240
        fallback = bilinear(base, 1905.5 - k * x, 1905.5 + k * y)
        lng, lt = np.degrees(np.arctan2(y, x)), np.degrees(np.arcsin(z))
        px, py = project.transform(lng, lt)
        col, row = inverse * (px, py)
        local = bilinear(fine, row - 0.5, col - 0.5)
        return np.where(np.isfinite(local), local, fallback), np.isfinite(local)

    phi, lam = np.radians([lat, lon])
    u = np.array([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])
    north = np.array([-np.sin(phi) * np.cos(lam), -np.sin(phi) * np.sin(lam), np.cos(phi)])
    east = np.array([-np.sin(lam), np.cos(lam), 0])
    ground, local = height(*u)
    if not bool(local):
        raise ValueError("Site not covered by local DEM")
    r0 = R + float(ground) + doc["observer_height_m"]
    # Dense near-field sampling; broader far-field retained to 250km.
    distances = np.concatenate(
        [np.arange(5, 5001, 5), np.arange(5020, 20001, 20), np.arange(20240, 250001, 240)]
    )
    cs, sn = np.cos(distances / R), np.sin(distances / R)
    profile = []
    for az in np.arange(0, 360, 0.1):
        tangent = north * np.cos(np.radians(az)) + east * np.sin(np.radians(az))
        points = u[:, None] * cs + tangent[:, None] * sn
        h, _ = height(*points)
        if not np.all(np.isfinite(h)):
            raise ValueError("Incomplete far-field coverage")
        angle = np.degrees(np.arctan(((R + h) * cs - r0) / ((R + h) * sn)))
        profile.append(round(float(np.max(angle)), 6))
    doc["points"]["center"] = profile
    doc["center_precision"] = {
        "near_dem_m": scale,
        "far_dem_m": 240,
        "azimuth_step_deg": 0.1,
        "source": "https://pgda.gsfc.nasa.gov/products/78",
        "product": "Site04_final_adj_5mpp_surf.tif",
        "note": "5m grid includes interpolated elevations; no certified timing uncertainty",
    }
    # step_deg describes center; neighbours retain 1 degree bins.
    doc["step_deg"] = 0.1
    temp = path.with_suffix(".json.part")
    temp.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    temp.replace(path)
    print(f"SR1: {len(profile)} horizon bins, local {scale}m + 240m far-field")


if __name__ == "__main__":
    main()
