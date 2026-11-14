"""Validate every generated ephemeris JSON against the shared schema.

Runs offline against committed files only; Horizons is never called.
"""

import itertools
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jsonschema
import pytest

from pipeline.generate import SITES

REPO_ROOT = Path(__file__).parents[2]
DATA_DIR = REPO_ROOT / "web" / "public" / "data"
SCHEMA = json.loads((REPO_ROOT / "schema" / "ephemeris.schema.json").read_text())

EXPECTED_FILES = sorted(f"{site.slug}_{body}.json" for site in SITES for body in ("sun", "earth"))


def test_exactly_the_sixteen_curated_files_exist() -> None:
    assert sorted(p.name for p in DATA_DIR.glob("*.json")) == EXPECTED_FILES


@pytest.mark.parametrize("filename", EXPECTED_FILES)
def test_file_matches_schema_and_range(filename: str) -> None:
    doc = json.loads((DATA_DIR / filename).read_text())
    jsonschema.validate(doc, SCHEMA)

    site = next(s for s in SITES if s.slug == doc["site"])
    assert doc["lat"] == site.lat
    assert doc["lon_e"] == site.lon_e

    samples = doc["samples"]
    times = [datetime.strptime(s["t"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) for s in samples]
    assert times[0] == datetime(2026, 11, 1, tzinfo=UTC)
    assert times[-1] == datetime(2027, 5, 1, tzinfo=UTC)
    assert all(b - a == timedelta(hours=1) for a, b in itertools.pairwise(times))
