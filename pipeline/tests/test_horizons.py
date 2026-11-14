import json
from datetime import UTC, datetime
from pathlib import Path

import jsonschema
import pytest

from pipeline.horizons import HorizonsError, Sample, parse_table

FIXTURES = Path(__file__).parent / "fixtures"
SCHEMA = Path(__file__).parents[2] / "schema" / "ephemeris.schema.json"


def load(name: str) -> list[Sample]:
    return parse_table((FIXTURES / name).read_text())


@pytest.mark.parametrize(
    ("fixture", "index", "when", "azimuth", "elevation"),
    [
        ("im2_sun.txt", 0, datetime(2026, 11, 14, tzinfo=UTC), 97.597, 0.871),
        ("im2_sun.txt", 1, datetime(2026, 11, 22, tzinfo=UTC), 0.181, 6.756),
        ("pole_sun.txt", 0, datetime(2026, 11, 14, tzinfo=UTC), 126.620, 1.497),
        ("pole_earth.txt", 0, datetime(2026, 11, 14, tzinfo=UTC), 358.773, -4.548),
    ],
)
def test_matches_horizons_reference_values(
    fixture: str, index: int, when: datetime, azimuth: float, elevation: float
) -> None:
    sample = load(fixture)[index]
    assert sample.time == when
    assert sample.azimuth_deg == pytest.approx(azimuth, abs=0.001)
    assert sample.elevation_deg == pytest.approx(elevation, abs=0.001)


def test_error_response_is_rejected() -> None:
    with pytest.raises(HorizonsError):
        parse_table("API ERROR: bad input")


def test_samples_fit_the_published_schema() -> None:
    schema = json.loads(SCHEMA.read_text())
    samples = load("im2_sun.txt")
    document = {
        "site": "im-2",
        "body": "sun",
        "lat": -84.78,
        "lon_e": 29.13,
        "samples": [
            {"t": s.time.isoformat(), "az": s.azimuth_deg, "el": s.elevation_deg} for s in samples
        ],
    }
    jsonschema.validate(document, schema)
