"""Terrain horizon masks from the LOLA south-polar DEM.

For each curated site inside the DEM, compute h(az): the elevation angle of the
terrain horizon for every degree of azimuth (north 0, east 90, the same
convention as the Horizons observer tables). The web app uses it in
visible(t) := el(t) + rho >= h(az(t)).

The same profile is computed for points 5, 10 and 20 km north, south, east and
west of each site, so the position-error evaluation uses terrain as well.

The raster (29 MB) is not committed. Download it once into pipeline/cache/lola/:
  https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_240m.img
Output: web/public/horizon/<slug>.json
"""

import argparse
import array
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.generate import REPO_ROOT, SITES, Site

RASTER = REPO_ROOT / "pipeline" / "cache" / "lola" / "ldem_75s_240m.img"
OUT_DIR = REPO_ROOT / "web" / "public" / "horizon"
SOURCE = "NASA LRO LOLA GDR LDEM_75S_240M (polar stereographic, 240 m/pix), PDS Geosciences Node"

MOON_RADIUS_M = 1_737_400.0
# LDEM_75S_240M label: 3812 x 3812, LSB 16-bit integer, HEIGHT = DN * 0.5 m.
RASTER_SIZE = 3812
RASTER_SCALE_M = 240.0
RASTER_DN_TO_M = 0.5

OBSERVER_HEIGHT_M = 2.0  # 착륙선 태양전지·안테나 높이로 잡은 값
MAX_DISTANCE_M = 250_000.0
# 가까운 곳은 격자 간격으로, 먼 곳은 두 배 간격으로 본다.
DISTANCES_M = [240.0 * k for k in range(1, 251)] + [
    60_000.0 + 480.0 * k for k in range(1, int((MAX_DISTANCE_M - 60_000.0) / 480.0) + 1)
]
OFFSETS_KM = (5, 10, 20)
BEARINGS = {"north": 0.0, "east": 90.0, "south": 180.0, "west": 270.0}
# 지평선을 250 km까지 보려면 지도 가장자리에서 떨어져 있어야 한다. 남위 80° 이남만 계산한다.
MAX_SITE_LAT = -80.0


@dataclass(frozen=True)
class Dem:
    """South-polar stereographic height grid. Longitude 0 points to the top row."""

    heights: "array.array[int]"
    size: int
    scale_m: float
    dn_to_m: float

    def height(self, nx: float, ny: float, nz: float) -> float | None:
        """Bilinear height (m) at the unit vector (nx, ny, nz); None outside the grid.

        The vector uses +x toward (lat 0, lon 0), +y toward (lat 0, lon 90E), +z north.
        """
        k = 2.0 * MOON_RADIUS_M / (1.0 - nz) / self.scale_m
        centre = (self.size - 1) / 2.0
        col = centre + k * ny
        row = centre - k * nx
        if not (0.0 <= col < self.size - 1 and 0.0 <= row < self.size - 1):
            return None
        c0 = int(col)
        r0 = int(row)
        fc = col - c0
        fr = row - r0
        base = r0 * self.size + c0
        h = self.heights
        top = h[base] * (1.0 - fc) + h[base + 1] * fc
        bottom = h[base + self.size] * (1.0 - fc) + h[base + self.size + 1] * fc
        return (top * (1.0 - fr) + bottom * fr) * self.dn_to_m


def load_dem(path: Path = RASTER) -> Dem:
    heights: array.array[int] = array.array("h")
    heights.frombytes(path.read_bytes())
    if len(heights) != RASTER_SIZE * RASTER_SIZE:
        raise ValueError(f"{path} is not a {RASTER_SIZE}x{RASTER_SIZE} 16-bit raster")
    if array.array("h", [1]).tobytes() != b"\x01\x00":
        heights.byteswap()  # 파일은 리틀 엔디언
    return Dem(heights, RASTER_SIZE, RASTER_SCALE_M, RASTER_DN_TO_M)


def unit_vector(lat: float, lon_e: float) -> tuple[float, float, float]:
    phi = math.radians(lat)
    lam = math.radians(lon_e)
    return (math.cos(phi) * math.cos(lam), math.cos(phi) * math.sin(lam), math.sin(phi))


def offset_coord(lat: float, lon_e: float, bearing_deg: float, km: float) -> tuple[float, float]:
    """Point reached from (lat, lon_e) after km along the given bearing (great circle).

    Mirrors offsetCoord in web/src/lib/robustness.ts.
    """
    d = km * 1000.0 / MOON_RADIUS_M
    p1 = math.radians(lat)
    b = math.radians(bearing_deg)
    sin_p2 = math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b)
    p2 = math.asin(max(-1.0, min(1.0, sin_p2)))
    dl = math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * sin_p2)
    lon = (lon_e + math.degrees(dl) + 180.0) % 360.0 - 180.0
    return (math.degrees(p2), lon)


def horizon_profile(
    dem: Dem, lat: float, lon_e: float, observer_height_m: float = OBSERVER_HEIGHT_M
) -> list[float]:
    """Terrain horizon elevation (deg) for azimuths 0..359 (north 0, east 90)."""
    ux, uy, uz = unit_vector(lat, lon_e)
    ground = dem.height(ux, uy, uz)
    if ground is None:
        raise ValueError(f"({lat}, {lon_e}) is outside the DEM")
    r0 = MOON_RADIUS_M + ground + observer_height_m

    phi = math.radians(lat)
    lam = math.radians(lon_e)
    north = (-math.sin(phi) * math.cos(lam), -math.sin(phi) * math.sin(lam), math.cos(phi))
    east = (-math.sin(lam), math.cos(lam), 0.0)
    steps = [(math.cos(d / MOON_RADIUS_M), math.sin(d / MOON_RADIUS_M)) for d in DISTANCES_M]

    profile: list[float] = []
    for az in range(360):
        cb = math.cos(math.radians(az))
        sb = math.sin(math.radians(az))
        tx = cb * north[0] + sb * east[0]
        ty = cb * north[1] + sb * east[1]
        tz = cb * north[2] + sb * east[2]
        best = -math.inf  # tan(고도각)의 최댓값
        for cos_t, sin_t in steps:
            h = dem.height(
                ux * cos_t + tx * sin_t, uy * cos_t + ty * sin_t, uz * cos_t + tz * sin_t
            )
            if h is None:
                break  # 지도 밖은 볼 수 없다
            r1 = MOON_RADIUS_M + h
            ratio = (r1 * cos_t - r0) / (r1 * sin_t)
            if ratio > best:
                best = ratio
        profile.append(round(math.degrees(math.atan(best)), 3))
    return profile


def covered(site: Site) -> bool:
    return site.lat <= MAX_SITE_LAT


def build_document(dem: Dem, site: Site) -> dict[str, Any]:
    points: dict[str, list[float]] = {"center": horizon_profile(dem, site.lat, site.lon_e)}
    for name, bearing in BEARINGS.items():
        for km in OFFSETS_KM:
            lat, lon = offset_coord(site.lat, site.lon_e, bearing, km)
            points[f"{name}_{km}"] = horizon_profile(dem, lat, lon)
    return {
        "site": site.slug,
        "lat": site.lat,
        "lon_e": site.lon_e,
        "source": SOURCE,
        "observer_height_m": OBSERVER_HEIGHT_M,
        "max_distance_km": MAX_DISTANCE_M / 1000.0,
        "step_deg": 1,
        "points": points,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raster", type=Path, default=RASTER)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    args = parser.parse_args()

    dem = load_dem(args.raster)
    args.out.mkdir(parents=True, exist_ok=True)
    for site in SITES:
        if not covered(site):
            print(f"skip {site.slug}: outside the DEM coverage")
            continue
        doc = build_document(dem, site)
        path = args.out / f"{site.slug}.json"
        path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
        centre = doc["points"]["center"]
        print(f"wrote {path} (center horizon {min(centre):.2f}..{max(centre):.2f} deg)")


if __name__ == "__main__":
    main()
