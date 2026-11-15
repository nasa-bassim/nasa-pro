# Lunar Navigator

**An explainable lunar landing-site comparison tool powered by NASA ephemeris and terrain data.**

## 🌐 Language Guide for International Visitors

**Please note:** Lunar Navigator currently opens in Korean by default.

To use the application in English, simply click the **"English" button in the top-right corner** of the website.

The application supports both Korean and English. We recommend switching to English for the best experience during international judging.

Thank you for exploring our project!

Lunar Navigator helps users compare candidate lunar landing sites by answering a practical early-stage mission question:

> Where can a surface mission maintain useful sunlight and direct Earth visibility, and does that advantage remain when terrain, timing, and landing-position uncertainty are considered?

The project was created by **Nasa-bbajim** for the **2026 NASA International Space Apps Challenge**. It is an educational and preliminary planning tool, not a flight-certified landing-safety system.

- [Notion Project Documentation](https://app.notion.com/p/LUNAR-NAVIGATOR-731e77c562ec823e9589017a222c9155?source=copy_link)
- [NASA Space Apps team page](https://www.spaceappschallenge.org/2026/find-a-team/nasa-bbajim/?tab=project)
- [Source repository](https://github.com/nasa-bassim/nasa-pro)

## The problem

A visually promising point on the Moon is not automatically a useful surface-operations site. A mission may need sunlight for power and a direct line of sight to Earth for communication at the same time. Local terrain can also block either body even when a smooth-sphere calculation says it is above the horizon.

Existing lunar maps are excellent for exploring imagery and topography, but comparing these operational trade-offs often requires moving between datasets and interpreting raw ephemeris tables. Lunar Navigator brings those conditions into one comparison workflow and keeps the reasoning behind each result visible.

## What makes it different

- **Power and communication together:** compares sunlight, Earth contact, and the time when both conditions overlap.
- **Terrain-aware visibility:** applies azimuth-dependent terrain horizons derived from NASA LRO LOLA elevation data to six south-polar candidates.
- **Robustness, not only a best-case point:** checks whether a result survives changes in landing position and mission timing.
- **Explainable recommendations:** shows simultaneous visibility, sunlight share, longest continuous darkness, data coverage, and limitations instead of presenting an unexplained score.
- **Interactive exploration:** connects a rotatable 3D Moon and curated candidate sites to the detailed comparison workspace.
- **Reproducible data path:** records the source, processing method, cache behavior, and AI-assisted work used to build the project.

## What users can do

1. Explore curated lunar sites on an interactive 3D Moon.
2. Select one or more candidates and a 7-, 14-, or 28-day observation window.
3. Compare sunlight, Earth visibility, simultaneous visibility, and continuous darkness.
4. Turn LOLA-based terrain occlusion on or off where coverage is available.
5. Inspect how nearby landing positions and schedule changes affect the result.
6. Enter custom lunar coordinates when the backend Horizons proxy is running.

The word **recommended** in the interface means *most favorable under the selected sunlight-and-Earth-visibility criteria*. It does not mean that a site is safe or approved for landing.

## NASA data and scientific sources

| Source | How it is used |
| --- | --- |
| [NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) | Hourly Sun and Earth azimuth/elevation as observed from lunar coordinates |
| [NASA LRO LOLA GDR](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/) | 240 m/pixel south-polar elevation raster used to calculate terrain-horizon masks |
| [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) | LROC color and LOLA elevation products used for the 3D Moon surface and relief shading |
| [LRO WAC South Pole Mosaic](https://commons.wikimedia.org/wiki/File:LRO_WAC_South_Pole_Mosaic.jpg) | South-polar visual context |
| LROC, DLR, De Rosa et al., IAU Gazetteer, and NSSDC | References for the curated candidate-site coordinates |

The precomputed dataset covers **2026-11-01 through 2027-05-01** at **one-hour intervals**. Every generated ephemeris JSON file retains a NASA/JPL source signature. Full provenance, asset credits, and processing notes are documented in [`docs/sources.md`](docs/sources.md).

## Method

For each selected site and time window, Lunar Navigator:

1. Loads Sun and Earth observer ephemerides from precomputed Horizons responses or the backend proxy.
2. Compares each body's elevation with either the geometric horizon or the LOLA-derived terrain horizon for its azimuth.
3. Marks samples with sunlight, Earth contact, and simultaneous visibility.
4. Calculates total overlap, sunlight share, and longest continuous darkness.
5. Evaluates nearby positions and shifted start times under the same mission assumptions.
6. Exposes the individual metrics and caveats used by the comparison.

Terrain horizons are generated for each azimuth degree from a 240 m/pixel LOLA south-polar raster, using a nominal observer height of 2 m and searching terrain out to 250 km.

## Scientific scope and limitations

Lunar Navigator is designed for transparent comparison and education. Its results should be treated as preliminary visibility estimates.

- The current recommendation considers **sunlight, direct Earth visibility, terrain occlusion where available, and limited position/time robustness**.
- It does **not** assess local slope, boulders, craters, regolith properties, thermal limits, radiation, dust, descent trajectories, link budgets, scientific value, or resource accessibility.
- The one-hour sampling interval can shift a reported visibility boundary by up to roughly one sampling interval and can miss shorter events.
- LOLA terrain occlusion currently applies to six south-polar candidates. Sites outside the raster coverage use a smooth-sphere horizon and are labeled accordingly; those results are not equivalent to terrain-adjusted results.
- The terrain calculation depends on the selected raster resolution, nominal observer height, and 250 km search radius.
- Custom-coordinate analysis depends on the backend service and the availability of NASA/JPL Horizons.

These limits are shown because the project is intended to support reasoning, not replace complete mission design or landing-hazard analysis.

## Architecture

| Directory | Role |
| --- | --- |
| `pipeline/` | Python pipeline for Horizons acquisition, parsing, cached preprocessing, and LOLA terrain-horizon generation |
| `backend/` | Java/Spring Boot proxy and cache for custom-coordinate Horizons requests |
| `web/` | React, TypeScript, Vite, and Three.js application |
| `schema/` | Shared JSON schema for generated ephemeris data |
| `docs/` | Data provenance, asset attribution, and AI-use records |
| `scripts/` | Repository-wide validation commands |

Curated sites use static JSON in `web/public/data/` and can be explored without the backend. Only custom-coordinate analysis requires the Spring Boot proxy.

## Run locally

### Prerequisites

- Node.js and pnpm 10
- JDK 26 for the backend
- [`uv`](https://docs.astral.sh/uv/) for the Python pipeline and its tests

### Frontend

```bash
cd web
pnpm install
pnpm dev
```

Open [http://127.0.0.1:5174/](http://127.0.0.1:5174/). The curated candidates work without starting the backend.

### Backend for custom coordinates

```bash
cd backend
./gradlew bootRun
```

The frontend development server proxies `/api` requests to `http://localhost:8080`.

### Full validation

```bash
./scripts/check.sh
```

The validation script checks oversized tracked files, Python formatting/types/tests, Spring Boot tests, frontend linting, Vitest tests, and the production build. CI uses saved Horizons fixtures and does not call the live NASA service.

## Backend request handling

Uncached custom-coordinate requests are processed sequentially with a two-second interval between upstream Horizons calls. Responses are cached on disk, and identical concurrent requests share one upstream task.

- Queue full: HTTP `503` with `Retry-After: 2`
- Request deadline exceeded: HTTP `504`
- Other Horizons failures: HTTP `502`

The default queue capacity is 16 and the combined request deadline is 120 seconds. These are prototype operating defaults and must be tuned for production traffic.

## AI use disclosure

Claude Code, Devin, ChatGPT/Codex, and Aside were used during development for repository scaffolding, implementation assistance, debugging, UI refinement, documentation, and review. Team members reviewed the resulting changes and used automated tests and source records to validate the implementation.

AI was not used to invent or replace NASA scientific datasets. The application calculations operate on cited NASA/JPL Horizons and LRO-derived data. Earlier chronological development records are maintained in [`docs/sources.md`](docs/sources.md#ai-%EC%82%AC%EC%9A%A9-%EA%B8%B0%EB%A1%9D).

## Project status

This repository contains a working hackathon prototype. Planned extensions include broader high-resolution terrain coverage, finer temporal sampling, and independent comparison against published lunar-illumination references.
