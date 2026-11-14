"""JPL Horizons observer tables for a point on the lunar surface."""

import hashlib
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
SUN = "10"
EARTH = "399"
# Horizons publishes no numeric rate limit, so requests stay sequential and spaced.
REQUEST_INTERVAL_SECONDS = 2.0

_ROW = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}) (.)(.)\s+([\d.]+)\s+(-?[\d.]+)\s*$")


class HorizonsError(RuntimeError):
    pass


@dataclass(frozen=True)
class Sample:
    time: datetime
    azimuth_deg: float
    elevation_deg: float
    # Horizons daylight/interfering-bodylight markers; stored but never used for judgement.
    flags: str = ""


def request_params(
    body: str, lon_e: float, lat: float, start: str, stop: str, step: str
) -> dict[str, str]:
    """Altitude stays 0: a site altitude only matters through terrain, handled separately."""
    return {
        "format": "text",
        "COMMAND": f"'{body}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon_e},{lat},0'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": "'4'",
    }


def fetch_cached(params: dict[str, str], cache_dir: Path) -> str:
    """Return the raw response, calling Horizons only when it is not cached yet."""
    query = urllib.parse.urlencode(sorted(params.items()))
    path = cache_dir / f"{hashlib.sha256(query.encode()).hexdigest()[:16]}.txt"
    if path.exists():
        return path.read_text()
    with urllib.request.urlopen(f"{API_URL}?{query}", timeout=120) as response:
        text = response.read().decode()
    parse_table(text)  # Never cache an error response.
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    time.sleep(REQUEST_INTERVAL_SECONDS)
    return text


def parse_table(text: str) -> list[Sample]:
    start = text.find("$$SOE")
    end = text.find("$$EOE")
    if start == -1 or end == -1:
        raise HorizonsError(f"no ephemeris table in response: {text[:300]}")
    samples: list[Sample] = []
    for line in text[start:end].splitlines()[1:]:
        match = _ROW.match(line)
        if match is None:
            raise HorizonsError(f"unexpected table row: {line!r}")
        moment = datetime.strptime(match[1], "%Y-%b-%d %H:%M").replace(tzinfo=UTC)
        flags = (match[2] + match[3]).strip()
        samples.append(Sample(moment, float(match[4]), float(match[5]), flags))
    return samples


def signature(text: str) -> str:
    """The API's own attribution string, e.g. 'NASA/JPL Horizons API 1.2'."""
    match = re.search(r'"source"\s*:\s*"([^"]+)".*?"version"\s*:\s*"([^"]+)"', text, re.DOTALL)
    if match is None:
        return "NASA/JPL Horizons API"
    return f"{match[1]} {match[2]}"
