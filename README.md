# StriX Scene Explorer

An operator-style console for SAR satellite mission planning: acquisition footprints, TLE-derived ground tracks, access windows, and scene metadata. Python notebooks to understand the data, a Go service on GCP to serve it, a React and Deck.gl frontend to fly it.

> Working title. Independent portfolio project. Not affiliated with Synspective.

## Purpose

This repository explores one question: how do you turn the operational data around a SAR satellite acquisition — orbit, geometry, footprint, product metadata — into an interface an operator could actually work in?

It is built in three layers, in the order you would really build them:

1. **Understand the data.** Jupyter notebooks that open a real StriX product, read its geometry and metadata, check those fields against Synspective's published SAR Data Product Format Manual, and plot the results.
2. **Serve it.** A Go backend on GCP that exposes scenes, propagates orbits from TLE data, and computes access windows over a set of ground targets.
3. **Fly it.** A React and TypeScript console: a Deck.gl map for footprints and ground tracks, a D3 timeline for acquisition opportunities and ground-station passes, and a metadata panel modeled on real SAR product fields.

## Why I am building this

I am applying for the FullStack Engineer (Satellite Operation Planning) role at Synspective — the Data Production Department team that builds and runs the Spacecraft Control Subsystem for the StriX constellation. That role is about turning flight dynamics and operation-planning data into dashboards and interactive tools, and cutting manual steps out of a human-in-the-loop workflow.

Rather than assert that I can do that, this repo does it, on their own published data model, with the stack the role actually names.

## Architecture

```
  data/  (local only, gitignored)
  StriX-3 GRD GeoTIFF + Format Manual PDF
                 │
                 ▼
  notebooks/  Python — rasterio, GeoPandas, sgp4, matplotlib
  read the product, verify fields against the manual,
  derive footprint / geometry / ground track
                 │
                 ▼  derived artifacts
        ┌────────────────────────┐
        │  GCS bucket            │  COG quicklook, footprint GeoJSON
        │  BigQuery              │  scene metadata table
        └────────────────────────┘
                 ▲
                 │
   ┌─────────────┴──────────────┐
   │  Go, Cloud Run             │
   │                            │
   │  scene-service ──gRPC──▶ flightdyn-service
   │  (catalog, query)         (SGP4 propagation,
   │                            access windows)
   └─────────────┬──────────────┘
                 │  Connect / gRPC-Web / JSON
                 ▼
   React + TypeScript + Vite
   Deck.gl (map, footprints, ground track)
   D3 (opportunity + pass timeline)
```

Two Go services, not one. `scene-service` owns the catalog and is the frontend's entry point; `flightdyn-service` owns orbit propagation and access-window computation and is called over gRPC. The split is real rather than decorative: propagation is CPU-bound and fans out, the catalog is I/O-bound against BigQuery, and they scale differently on Cloud Run.

Browsers cannot speak raw gRPC, so the edge is served with [Connect](https://connectrpc.com) — one Go handler serves the Connect, gRPC, and gRPC-Web protocols from the same `.proto` definitions, and the frontend gets a generated, typed TypeScript client with no separate REST layer to keep in sync.

### Clean Architecture

The Go code is layered so that dependencies point inward only. `domain` knows nothing about protobuf, BigQuery, or HTTP; adapters depend on ports, never the reverse.

| Layer | Contains | May import |
| --- | --- | --- |
| `domain` | Scene, Orbit, AccessWindow, Plan — entities and rules | nothing internal |
| `usecase` | application services, orchestration | `domain`, `port` |
| `port` | interfaces the usecases require | `domain` |
| `adapter` | Connect handlers, BigQuery/GCS/Celestrak repositories | `usecase`, `port`, `domain` |
| `infra` | config, logging, tracing, dependency wiring | all of the above |

### Concurrency

Access-window computation is where Go earns its place. Given N satellites, M ground targets, and a horizon of several days at a fixed time step, the work is a wide independent fan-out with a natural merge at the end.

- A bounded worker pool sized to `GOMAXPROCS`, fed from a job channel of `(satellite, target, time-slice)` tuples.
- `errgroup.WithContext` for fan-out and first-error cancellation.
- `context` cancellation propagated from the Connect handler, so closing the browser tab stops the compute.
- Server-streaming RPC so the UI paints windows as they are found instead of blocking on the whole horizon.

### Cloud

| Concern | Service |
| --- | --- |
| Product and derived artifact storage | Cloud Storage |
| Scene metadata catalog | BigQuery |
| Service hosting | Cloud Run (gRPC and server streaming supported) |
| Container images | Artifact Registry |
| Notebook environment | Vertex AI Workbench, or local Jupyter |
| Infrastructure as code | Terraform |
| CI/CD | GitHub Actions — lint, test, `buf breaking`, build, deploy |
| Frontend hosting | static build on Cloud Storage behind Cloud CDN |

The whole thing is sized to sit inside GCP's free tier with Cloud Run scaling to zero.

## Stack

| Area | Choice |
| --- | --- |
| Backend | Go 1.23+, Connect-Go, protobuf, Buf for codegen and lint |
| Orbit math | SGP4 propagation from Celestrak TLE data |
| Data exploration | Python, JupyterLab, rasterio, GeoPandas, Shapely, sgp4, matplotlib |
| Frontend | React, TypeScript, Vite |
| Visualization | Deck.gl and WebGL for geospatial layers, D3 for the timeline |
| Generated client | `@connectrpc/connect-web` with buf-generated TypeScript types |
| Testing | Go table-driven tests, Vitest, React Testing Library, Playwright |
| Deploy | Docker, Cloud Run, Terraform, GitHub Actions |

## Data

The prototype runs on Synspective's public sample data plus open orbital data. **No Synspective product data is committed to this repository.**

- **Real product sample.** A StriX-3 GRD GeoTIFF product, obtained through Synspective's own sample-data request and kept in `data/`, which is gitignored. It is used for analysis and for deriving a small quicklook only. It is never redistributed here, and it is used within Synspective's published terms, with attribution.
- **Format reference.** The Synspective SAR Data Product Format Manual (EN, v21-1), also local-only in `data/`. The notebooks use it as the authority for what each metadata field means; where the sample product and the manual disagree, the notebook records the discrepancy rather than papering over it.
- **Orbital data.** Public Two-Line Element sets from [Celestrak](https://celestrak.org/NORAD/elements/), fetched and cached server-side, used to propagate ground tracks and compute access windows.
- **Synthetic scenes.** To have enough scenes for the catalog and filters to be worth building, the repo generates mock scenes whose field names and structure follow the Format Manual — product level, imaging mode, footprint, incidence angle, look direction, orbit direction, NESZ, orbit source. Values are illustrative, not measured, and are labeled as synthetic in the UI.

## The notebooks

`notebooks/` is a deliverable, not a scratchpad. The interface is only credible if the data underneath it is understood first, and the notebooks are where that happens — and where the Go implementation gets its reference values.

| Notebook | What it establishes |
| --- | --- |
| `01-read-strix-product` | Open the GRD GeoTIFF, read its CRS, extent, dimensions, and embedded metadata; reconcile the filename convention and every field against the Format Manual |
| `02-footprint-and-geometry` | Derive the scene footprint polygon, scene center, swath, incidence angle, look and orbit direction; plot them |
| `03-tle-ground-track` | Propagate StriX TLEs with the Python `sgp4` reference implementation, plot the ground track, and emit fixtures the Go service is tested against |
| `04-access-windows` | Work out the access-window geometry — look-angle limits, ascending and descending passes — before it is ported to Go |

Notebook 03 has a second job: it is the oracle. The Go SGP4 path is verified against the Python reference implementation, so the backend's orbit math is checked against something independent rather than trusted.

## Repository layout

```
.
├── proto/strix/v1/              # scene.proto, flightdyn.proto — the contract
├── backend/
│   ├── cmd/
│   │   ├── scene-service/
│   │   └── flightdyn-service/
│   └── internal/
│       ├── domain/              # scene, orbit, access, plan
│       ├── usecase/
│       ├── port/                # repository + propagator interfaces
│       ├── adapter/
│       │   ├── connect/         # handlers, proto <-> domain mapping
│       │   └── repo/            # bigquery, gcs, celestrak
│       └── infra/               # config, logging, wiring
├── frontend/
│   ├── src/
│   │   ├── features/
│   │   │   ├── map/             # Deck.gl layers
│   │   │   ├── timeline/        # D3
│   │   │   └── scene-detail/
│   │   ├── gen/                 # buf-generated Connect client
│   │   └── lib/
│   └── e2e/                     # Playwright
├── notebooks/
├── infra/terraform/
├── data/                        # gitignored — sample product + manual
└── .github/workflows/
```

## Testing strategy

Three levels, because the interesting failures live at different ones.

**Backend.** Table-driven unit tests on `domain` and `usecase` with ports faked — no cloud, no network, fast. Orbit propagation is checked against the fixtures exported from notebook 03. Adapters are tested separately against emulators. `buf breaking` runs in CI so the proto contract cannot regress silently.

**Frontend units.** Vitest and React Testing Library for state, filters, formatting, and panel behavior.

**The WebGL problem.** A Deck.gl canvas is opaque to DOM assertions — there is nothing to query. Three things are done about it:

- Layer construction is pulled out into pure functions that take scene data and return Deck.gl layer configuration. Those are unit-tested directly, which covers most of what can actually break.
- Playwright drives the real app end to end and asserts on the DOM shell around the canvas: tooltips, the metadata panel, the timeline, URL state.
- Deck.gl's `onAfterRender` plus a deterministic camera give a stable screenshot for visual regression on a small set of key views.

## Running it locally

Prerequisites: Go 1.23+, Node 20+, Python 3.11+, Docker, and the `buf` CLI.

```sh
make bootstrap        # go mod download, npm ci, python venv + requirements
make generate         # buf generate — Go and TypeScript from proto/
make dev              # docker compose: both services + vite dev server
make test             # go test ./... && npm test
make e2e              # playwright
make notebooks        # jupyter lab
```

`make dev` runs against a local fixture dataset and needs no GCP credentials. Pointing it at real Cloud Storage and BigQuery is opt-in through `.env`.

## Build status

The repo is being built in public and is early. Nothing below is claimed as working until it is checked off.

- [x] Sample product and Format Manual acquired
- [x] Scope, architecture, and stack decided
- [ ] Notebooks 01–02: product read, footprint and geometry derived
- [ ] `proto/` contract defined, `buf generate` wired up
- [ ] `scene-service`: domain, usecases, Connect handlers, fixture repository
- [ ] Frontend: Deck.gl map with footprint and metadata panel
- [ ] Notebooks 03–04, with exported fixtures
- [ ] `flightdyn-service`: SGP4 propagation, ground track, access windows, streaming RPC
- [ ] D3 timeline of acquisition opportunities and ground-station passes
- [ ] BigQuery and GCS repositories behind the existing ports
- [ ] Terraform, GitHub Actions, Cloud Run deploy
- [ ] Playwright suite and visual regression
- [ ] Deployed link

## What this project exercises

Honestly, including where it falls short.

| Area | Where it shows up |
| --- | --- |
| Go backend services | Two services, `backend/`, layered and tested |
| gRPC and microservices | Connect-Go over protobuf; service-to-service gRPC; Buf-managed contract |
| Clean Architecture | `domain` / `usecase` / `port` / `adapter` / `infra`, dependencies inward only |
| Concurrency patterns | Bounded worker pool, `errgroup`, context cancellation, streaming results |
| Modern frontend | React, TypeScript, Vite, typed generated client |
| Data visualization | Deck.gl and WebGL layers, D3 timeline |
| Satellite visualization from TLE | SGP4 ground tracks and access windows, verified against a Python reference |
| UI testing strategy | Pure layer functions, Vitest, Playwright, visual regression on the canvas |
| GCP | Cloud Run, Cloud Storage, BigQuery, Artifact Registry, Terraform, GitHub Actions |
| Domain understanding | Notebooks reading a real StriX product against the published Format Manual |

What a portfolio project cannot show, and I am not going to pretend otherwise: years of running production systems on GCP under real load and real cost pressure, working in a team of engineers over months, or the operational judgment that only comes from supporting a live constellation. Those are on my CV and in conversation, not in this repo.

## Non-goals

- Real SAR signal or image processing. The interface works from metadata, vector geometry, and at most a small georeferenced quicklook.
- Command generation, or any connection to a real control system.
- Authentication, multi-tenancy, or production hardening.
- Full-resolution raster rendering in the browser.

## Success criteria

A reviewer opens the deployed link, understands what it does in two minutes, opens the repo, finds the Go layering and the tests clean, sees the notebooks and realizes the author read the Format Manual rather than guessing — and comes away convinced I understand both the data and the operator's job.

## Links

- Synspective: https://www.synspective.com/
- Target role: https://careers.synspective.com/o/fullstack-engineer-satellite-opearation-planning
- SAR Data Product Format Manual (EN, v21-1): https://www.synspective.com/files/co/document-files/SAR-Data-Product-Format-Manual_EN_v21-1.pdf
- StriX sample data gallery: https://www.synspective.com/gallery/
- Celestrak TLE data: https://celestrak.org/NORAD/elements/

## Disclaimer

Independent, unofficial project built for a job application. Not affiliated with, authorized by, or endorsed by Synspective. "Synspective" and "StriX" are trademarks of their respective owner. Any referenced data belongs to its original owner and is used here only for a non-commercial demonstration, within the owner's published terms.
