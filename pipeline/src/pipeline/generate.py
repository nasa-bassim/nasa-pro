"""Pre-compute Horizons observer tables for the curated sites (PRD 5.1, 5.4).

Sequential calls, cached under pipeline/cache/, so re-runs never re-hit the API.
Output: one JSON per site per body into web/public/data/, matching
schema/ephemeris.schema.json.
"""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.horizons import EARTH, SUN, fetch_cached, parse_table, request_params, signature

START = "2026-Nov-01 00:00"
STOP = "2027-May-01 00:00"
STEP = "1h"

REPO_ROOT = Path(__file__).parents[3]
CACHE_DIR = REPO_ROOT / "pipeline" / "cache"
DATA_DIR = REPO_ROOT / "web" / "public" / "data"
FIXTURE_DIR = REPO_ROOT / "web" / "test" / "fixtures"


@dataclass(frozen=True)
class Site:
    slug: str
    name: str
    lat: float
    lon_e: float


SITES = [
    Site("im-2", "IM-2 의도 착륙지 (Mons Mouton)", -84.78, 29.13),
    Site("im-1", "IM-1 착륙지 (Malapert A 부근)", -80.13, 1.44),
    Site("cr1", "Connecting Ridge (CR1)", -89.4679, -137.411),
    Site("sr1", "Shackleton Rim (SR1)", -89.7755, -156.448),
    Site("mp2", "Malapert Peak (MP2)", -86.0265, 2.758),
    Site("gr2", "de Gerlache Rim (GR2)", -89.0073, -94.7636),
    Site("chandrayaan-3", "Chandrayaan-3 Statio Shiv Shakti", -69.37, 32.32),
    Site("apollo-11", "Apollo 11 LM", 0.67416, 23.47314),
]

# PRD acceptance criteria 2 and 6 use this reference point, which is not one of
# the eight curated sites. It is generated as a test fixture only.
POLE = Site("pole", "기준 지점", -89.9, 0.0)

BODIES = [("sun", SUN), ("earth", EARTH)]


def build_document(site: Site, body: str, body_code: str) -> dict[str, Any]:
    params = request_params(body_code, site.lon_e, site.lat, START, STOP, STEP)
    text = fetch_cached(params, CACHE_DIR)
    samples = parse_table(text)
    return {
        "site": site.slug,
        "name": site.name,
        "body": body,
        "lat": site.lat,
        "lon_e": site.lon_e,
        "source": signature(text),
        "samples": [
            {
                "t": s.time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "az": s.azimuth_deg,
                "el": s.elevation_deg,
                "flags": s.flags,
            }
            for s in samples
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DATA_DIR)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    for site in SITES:
        for body, code in BODIES:
            doc = build_document(site, body, code)
            path = args.out / f"{site.slug}_{body}.json"
            path.write_text(json.dumps(doc, ensure_ascii=False) + "\n")
            print(f"wrote {path} ({len(doc['samples'])} samples)")

    if args.out == DATA_DIR:
        FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
        for body, code in BODIES:
            doc = build_document(POLE, body, code)
            path = FIXTURE_DIR / f"pole_{body}.json"
            path.write_text(json.dumps(doc, ensure_ascii=False) + "\n")
            print(f"wrote {path} ({len(doc['samples'])} samples)")


if __name__ == "__main__":
    main()
