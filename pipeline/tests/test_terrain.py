"""Terrain horizon: geometry on synthetic grids, plus the committed outputs.

Runs offline; the LOLA raster is never needed.
"""

import array
import json
import math
from pathlib import Path

import pytest

from pipeline.generate import SITES
from pipeline.terrain import (
    BEARINGS,
    MOON_RADIUS_M,
    OFFSETS_KM,
    Dem,
    covered,
    horizon_profile,
    offset_coord,
    unit_vector,
)

REPO_ROOT = Path(__file__).parents[2]
HORIZON_DIR = REPO_ROOT / "web" / "public" / "horizon"
SIZE = 2401  # 240 m 격자로 극에서 288 km까지


def grid(height_dn: int = 0) -> "array.array[int]":
    return array.array("h", [height_dn]) * (SIZE * SIZE)


def test_flat_sphere_horizon_is_the_geometric_dip() -> None:
    dem = Dem(grid(), SIZE, 240.0, 0.5)
    profile = horizon_profile(dem, -89.5, 30.0, observer_height_m=100.0)
    dip = -math.degrees(math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + 100.0)))
    assert max(profile) == pytest.approx(dip, abs=0.01)
    assert min(profile) == pytest.approx(dip, abs=0.01)


def test_wall_toward_longitude_zero_blocks_only_that_side() -> None:
    # 경도 0° 방향(격자 위쪽)으로 극에서 30 km 넘는 곳이 2 km 높다.
    heights = grid()
    centre = (SIZE - 1) // 2
    for row in range(centre - 125):
        for col in range(SIZE):
            heights[row * SIZE + col] = 4000
    dem = Dem(heights, SIZE, 240.0, 0.5)
    # 경도 0° 자오선 위, 극에서 약 6 km: 북쪽(방위 0)이 벽 쪽이다.
    profile = horizon_profile(dem, -89.8, 0.0)
    distance = 30_000.0 - (90.0 - 89.8) * math.pi / 180.0 * MOON_RADIUS_M
    theta = distance / MOON_RADIUS_M  # 곡률 때문에 벽 꼭대기가 조금 내려가 보인다
    r0 = MOON_RADIUS_M + 2.0
    r1 = MOON_RADIUS_M + 2000.0
    expected = math.degrees(math.atan2(r1 * math.cos(theta) - r0, r1 * math.sin(theta)))
    assert profile[0] == pytest.approx(expected, abs=0.1)
    assert profile[180] < 0.0
    assert profile[0] > profile[60] > profile[180]


def test_dem_reads_longitude_ninety_east_on_the_right() -> None:
    heights = grid()
    centre = (SIZE - 1) // 2
    heights[centre * SIZE + centre + 100] = 2000  # 극에서 오른쪽으로 24 km
    dem = Dem(heights, SIZE, 240.0, 0.5)
    lat = -90.0 + math.degrees(2.0 * math.atan(24_000.0 / (2.0 * MOON_RADIUS_M)))
    assert dem.height(*unit_vector(lat, 90.0)) == pytest.approx(1000.0, abs=1.0)
    assert dem.height(*unit_vector(lat, -90.0)) == pytest.approx(0.0, abs=1.0)
    assert dem.height(*unit_vector(-60.0, 0.0)) is None


def test_offset_coord_moves_the_requested_distance() -> None:
    lat, lon = offset_coord(-84.78, 29.13, 0.0, 10.0)
    assert lat == pytest.approx(-84.78 + math.degrees(10_000.0 / MOON_RADIUS_M))
    assert lon == pytest.approx(29.13)
    for bearing in BEARINGS.values():
        a = unit_vector(-89.7755, -156.448)
        b = unit_vector(*offset_coord(-89.7755, -156.448, bearing, 20.0))
        angle = math.acos(sum(p * q for p, q in zip(a, b, strict=True)))
        assert angle * MOON_RADIUS_M == pytest.approx(20_000.0, rel=1e-6)


EXPECTED = sorted(f"{site.slug}.json" for site in SITES if covered(site))


def test_exactly_the_covered_sites_have_a_horizon_file() -> None:
    assert sorted(p.name for p in HORIZON_DIR.glob("*.json")) == EXPECTED
    assert len(EXPECTED) == 6


@pytest.mark.parametrize("filename", EXPECTED)
def test_horizon_file_shape(filename: str) -> None:
    doc = json.loads((HORIZON_DIR / filename).read_text())
    site = next(s for s in SITES if s.slug == doc["site"])
    assert (doc["lat"], doc["lon_e"]) == (site.lat, site.lon_e)
    keys = {"center"} | {f"{name}_{km}" for name in BEARINGS for km in OFFSETS_KM}
    assert set(doc["points"]) == keys
    for profile in doc["points"].values():
        assert len(profile) == 360
        assert all(-10.0 < h < 45.0 for h in profile)
