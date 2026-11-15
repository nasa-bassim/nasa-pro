"""Real Horizons refinement: terrain-knot screening, padded windows, 5 then 1 minute."""

import argparse
import hashlib
import json
import math
import subprocess
import time
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any

from pipeline.generate import BODIES, CACHE_DIR, DATA_DIR, REPO_ROOT, SITES
from pipeline.horizons import API_URL, fetch_cached, parse_table, request_params


def risky(a: dict[str, Any], b: dict[str, Any], h: list[float], radius: float) -> bool:
    da: float = (b["az"] - a["az"] + 180) % 360 - 180
    fractions = [0.0, 0.5, 1.0]
    if da and h:
        step = 360 / len(h)
        low, high = sorted((a["az"], a["az"] + da))
        fractions += [
            (k * step - a["az"]) / da
            for k in range(math.floor(low / step) + 1, math.ceil(high / step))
        ]
    values: list[float] = []
    for f in fractions:
        el: float = a["el"] + (b["el"] - a["el"]) * f + radius
        x: float = ((a["az"] + da * f) % 360) / 360 * len(h)
        i = math.floor(x)
        height = h[i] * (1 - (x - i)) + h[(i + 1) % len(h)] * (x - i) if h else 0
        values.append(el - height)
    return min(values) <= 0.25 and max(values) >= -0.25


def windows(samples: list[dict[str, Any]], h: list[float], radius: float) -> list[tuple[str, str]]:
    selected: list[tuple[str, str]] = []
    indices: set[int] = set()
    for i, (a, b) in enumerate(zip(samples, samples[1:], strict=False)):
        if risky(a, b, h, radius) or risky(a, b, [], radius):
            indices.update(range(max(0, i - 1), min(len(samples) - 1, i + 2)))
    for i in sorted(indices):
        start, end = samples[i]["t"], samples[i + 1]["t"]
        if selected and selected[-1][1] == start:
            selected[-1] = (selected[-1][0], end)
        else:
            selected.append((start, end))
    return selected


def fetch_with_curl(params: dict[str, str]) -> str:
    query = urllib.parse.urlencode(sorted(params.items()))
    path = CACHE_DIR / f"{hashlib.sha256(query.encode()).hexdigest()[:16]}.txt"
    if path.exists():
        return path.read_text()
    text = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--max-time", "120", f"{API_URL}?{query}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    parse_table(text)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".txt.part")
    temporary.write_text(text)
    temporary.replace(path)
    time.sleep(2)
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", choices=[s.slug for s in SITES], required=True)
    parser.add_argument("--curl", action="store_true", help="Use system curl with TLS verification")
    args = parser.parse_args()
    hp = REPO_ROOT / "web/public/horizon" / f"{args.site}.json"
    h: list[float] = json.loads(hp.read_text())["points"]["center"] if hp.exists() else []
    out = REPO_ROOT / "web/public/refined"
    out.mkdir(parents=True, exist_ok=True)
    for body, code in BODIES:
        doc = json.loads((DATA_DIR / f"{args.site}_{body}.json").read_text())
        samples = doc["samples"]
        passes: list[dict[str, Any]] = []
        for step in (5, 1):
            spans = windows(samples, h, 0.27 if body == "sun" else 0.93)
            merged = {s["t"]: s for s in samples}
            calls = 0
            for start, end in spans:
                t = datetime.fromisoformat(start.replace("Z", "+00:00"))
                stop = datetime.fromisoformat(end.replace("Z", "+00:00"))
                while t < stop:
                    until = min(stop, t + timedelta(days=1))
                    params = request_params(
                        code,
                        doc["lon_e"],
                        doc["lat"],
                        t.strftime("%Y-%m-%d %H:%M"),
                        until.strftime("%Y-%m-%d %H:%M"),
                        f"{step}m",
                    )
                    for s in parse_table(
                        fetch_with_curl(params) if args.curl else fetch_cached(params, CACHE_DIR)
                    ):
                        iso = s.time.strftime("%Y-%m-%dT%H:%M:%SZ")
                        merged[iso] = {"t": iso, "az": s.azimuth_deg, "el": s.elevation_deg}
                    calls += 1
                    t = until
            old_samples = samples
            samples = sorted(merged.values(), key=lambda s: s["t"])
            passes.append(
                {
                    "stepMinutes": step,
                    "windows": spans,
                    "requests": calls,
                    "samplesBefore": len(old_samples),
                    "samplesAfter": len(samples),
                }
            )
            print(f"{args.site} {body}: {step} min, {calls} requests", flush=True)
        result: dict[str, Any] = {
            **doc,
            "samples": samples,
            "refinement": {
                "method": "Horizons 5m/1m, horizon knots + 0.25deg trigger + neighbour spans",
                "generatedAt": datetime.now(UTC).isoformat(),
                "passes": passes,
                "note": "Sampling interval is not a guaranteed event-time error bound",
            },
        }
        path = out / f"{args.site}_{body}.json"
        temporary = path.with_suffix(".json.part")
        temporary.write_text(json.dumps(result, separators=(",", ":")) + "\n")
        temporary.replace(path)


if __name__ == "__main__":
    main()
