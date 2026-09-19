# StriX Scene Explorer

An operator-style console for SAR satellite mission planning: acquisition footprints, TLE-derived ground tracks, access windows, and scene metadata. Python notebooks to understand the data, a Go service on GCP to serve it, a React and Deck.gl frontend to fly it.

**Live: https://web-g7vdca6wsq-an.a.run.app**

> Working title. Independent portfolio project. Not affiliated with Synspective.

## Purpose

This repository explores one question: how do we turn the operational data around a SAR satellite acquisition — orbit, geometry, footprint, product metadata — into an interface an operator could actually work in?

It is built in three layers, in the order they would really be built:

1. **Understand the data.** Jupyter notebooks that open a real StriX product, read its geometry and metadata, check those fields against Synspective's published SAR Data Product Format Manual, and plot the results.
2. **Serve it.** A Go backend on GCP that exposes scenes, propagates orbits from TLE data, and computes access windows over a set of ground targets.
3. **Fly it.** A React and TypeScript console: a Deck.gl map for footprints and ground tracks, a D3 timeline for acquisition opportunities and ground-station passes, and a metadata panel modeled on real SAR product fields.

## Why I am building this

I am applying for the FullStack Engineer (Satellite Operation Planning) role at Synspective — the Data Production Department team that builds and runs the Spacecraft Control Subsystem for the StriX constellation. That role is about turning flight dynamics and operation-planning data into dashboards and interactive tools, and cutting manual steps out of a human-in-the-loop workflow.

Rather than assert that I can do that, this repo does it, on their own published data model, with the stack the role actually names.

## Architecture

```
  data/  (local only, gitignored)
  one StriX-3 scene, 4 product levels + Format Manual PDF
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
   │  scene-service ──HTTP──▶ flightdyn-service
   │  :8080                    :8081
   │  (catalog, query)         (SGP4 propagation,
   │                            access windows)
   └─────────────┬──────────────┘
                 │  JSON over HTTP
                 ▼
   React + TypeScript + Vite
   Deck.gl (map, footprints, ground track)
   D3 (opportunity + pass timeline)
```

Two Go services, not one. `scene-service` owns the catalog and is the frontend's entry point; `flightdyn-service` owns orbit propagation and access-window computation and is called over HTTP. The split is real rather than decorative: propagation is CPU-bound and fans out, the catalog is I/O-bound against BigQuery, and they scale differently on Cloud Run.

**The transport is a JSON API over HTTP, not gRPC, and that was a decision rather than a shortcut.** An earlier draft of this README specified Connect-Go over protobuf. What got built is `net/http` and `encoding/json`, because the whole surface is six read-only `GET` endpoints, the only client is one browser, and protobuf would have added a code-generation step, a `buf` toolchain and a generated client to a contract that fits on one screen.

The cost of that choice is real, and it is paid where the two halves meet: nothing in TypeScript can check `frontend/src/interfaces/wire.ts` against the Go structs, so `backend/internal/adapter/httpapi/contract_test.go` pins every field name the frontend reads. That is a hand-written stand-in for `buf breaking`, and it is worth saying plainly that it is a weaker one — it catches a rename, it does not catch a type change. If this grew a second client, write operations, or a streaming endpoint, the trade would flip.

### Clean Architecture

The Go code is layered so that dependencies point inward only. `domain` knows nothing about JSON, BigQuery, HTTP or SGP4; adapters depend on ports, never the reverse. The payoff shows up in the tests: the fakes are twenty lines of hand-written Go each, and there is no mocking library anywhere in the backend.

| Layer | Contains | May import |
| --- | --- | --- |
| `domain` | Scene, Satellite, Target, AccessWindow, and the access geometry | nothing internal |
| `usecase` | application services, orchestration | `domain`, `port` |
| `port` | interfaces the usecases require | `domain` |
| `adapter` | HTTP handlers, the wire shapes, the SGP4 library, file/BigQuery/GCS repositories | `usecase`, `port`, `domain` |
| `infra` | config, logging, tracing, dependency wiring | all of the above |

### Concurrency

Access-window computation is where Go earns its place. Given N satellites, M ground targets, and a horizon of several days at a fixed time step, the work is a wide independent fan-out with a natural merge at the end.

- `errgroup.WithContext` with `SetLimit(runtime.NumCPU())` over the `(satellite, target)` pairs. The work is CPU-bound, so the useful ceiling is the number of cores.
- Results collected into a slice indexed by pair, sized before any goroutine starts. No mutex and no channel: each worker writes to its own element, and the output order does not depend on who finished first.
- `context` cancellation propagated from the HTTP handler. A browser that reloads or navigates away aborts its fetch — `frontend/src/components/useConsoleData.ts` holds an `AbortController` and aborts it on effect cleanup — the connection closes, and the cancellation reaches the sweep through the request context instead of leaving it running for an answer nobody will read.

Deliberately **not** a worker-pool abstraction and **not** a job channel: `errgroup` already is the pool, and a layer on top would be one more thing to explain. Streaming results as they are found is not implemented either — the full three-day sweep over eight satellites and four targets finishes in about 80 ms, so there is nothing worth streaming around. That figure is measured and logged by `TestAccessWindowsReproduceTheWholeFixture` on every run, so it stops being true out loud if it ever stops being true. The same test then re-runs the identical sweep with `MaxParallel=1` and logs both numbers side by side — 69 ms across 24 workers against 817 ms serial on this machine — so the claim that the fan-out is what makes it fast has a baseline under it rather than a single figure with nothing to compare against. It also asserts the two results are identical, which is the check that the concurrency changes the speed and nothing else.

### Cloud

| Concern | Service |
| --- | --- |
| Product and derived artifact storage | Cloud Storage |
| Scene metadata catalog | BigQuery |
| Service hosting | Cloud Run, one revision per service |
| Container images | Artifact Registry |
| Notebook environment | Vertex AI Workbench, or local Jupyter |
| Infrastructure as code | Terraform |
| CI/CD | GitHub Actions — `go vet`, `go test`, `tsc`, `vitest`, build, deploy |
| Frontend hosting | static build on Cloud Storage behind Cloud CDN |

The whole thing is sized to sit inside GCP's free tier with Cloud Run scaling to zero.

## Stack

| Area | Choice |
| --- | --- |
| Backend | Go 1.24+, standard library for HTTP, JSON and logging (`net/http`, `encoding/json`, `log/slog`). Two external modules: `golang.org/x/sync` for `errgroup`, and `github.com/joshuaferrara/go-satellite` for SGP4 — whose measured deviation from the Python reference, and its cause, are documented in [backend/README.md](./backend/README.md) |
| Orbit math | SGP4 propagation from Celestrak TLE data |
| Data exploration | Python, JupyterLab, rasterio, GeoPandas, Shapely, sgp4, matplotlib |
| Frontend | React, TypeScript, Vite |
| Visualization | Deck.gl and WebGL for geospatial layers, D3 for the timeline |
| API client | a hand-written `fetch` client in `frontend/src/lib/api.ts`, with one wire-to-domain mapping in `lib/mapping.ts` |
| Testing | Go table-driven tests, Vitest, React Testing Library |
| Deploy | Not yet built — Cloud Run, Terraform and GitHub Actions are the intended targets (see Build status) |

## Data

The prototype runs on Synspective's public sample data plus open orbital data. **The delivered product files are not committed to this repository.**

What the repository does carry from that product is derived: rendered figures in the notebooks, and metadata field values quoted in their outputs. The reconstructed orbit is treated differently again — it is operational data, so `fixtures/precise_ephemeris.json` is git-ignored and the notebooks print only quantities derived from it, never the state vectors themselves.

That split is a judgement about Synspective's sample-data terms, not a licence to reuse. Anyone repeating this should read those terms rather than copy the line drawn here.

- **Real product sample.** One StriX-3 acquisition over Mt. Aso, Kyushu, obtained through Synspective's own sample-data request and kept in `data/`, which is gitignored. All four delivered product levels are used: SLC in CEOS and SICD/NITF, GRD GeoTIFF, and ORT (CEOS-ARD gamma0 and sigma0, with local-incidence-angle and layover/shadow masks as Cloud Optimized GeoTIFFs). The files themselves stay local; the figures derived from them appear in the notebooks with attribution.

  The scene: Sliding Spotlight, X-band at 9.65 GHz, VV, left-looking on an ascending pass, 34.3–35.2° incidence, 31.94° off-nadir, scene centre 32.8876 N / 131.0923 E at 2026-06-15T06:35:27Z, 1.41 s of acquisition, UTM zone 52N / WGS84.

- **Precise ephemeris.** The GRD parameter file carries 28 ECEF state vectors at 22.2 s spacing across a 10-minute arc bracketing the acquisition, flagged `Precise` / `DEFINITIVE`. This is the ground truth the propagation code is measured against, and it stays local: notebook 03 works from it but publishes only the orbital elements it yields.
- **Format reference.** The Synspective SAR Data Product Format Manual (EN, v21-1), also local-only in `data/`. The notebooks use it as the authority for what each metadata field means; where the product and the manual disagree, the notebook records the discrepancy rather than papering over it. One is already logged: the delivered metadata reports the mode as both `SP` and `SlidingSpotlight` depending on which file is read.
- **Orbital data.** Public Two-Line Element sets from [Celestrak](https://celestrak.org/NORAD/elements/), fetched and cached server-side, used to propagate ground tracks and compute access windows.
- **Synthetic scenes.** To have enough scenes for the catalog and filters to be worth building, the repo generates mock scenes whose field names and structure follow the Format Manual — product level, imaging mode, footprint, incidence angle, look direction, orbit direction, NESZ, orbit source. Values are illustrative, not measured, and are labeled as synthetic in the UI.

## The notebooks

`notebooks/` is a deliverable, not a scratchpad. The interface is only credible if the data underneath it is understood first, and the notebooks are where that happens — and where the Go implementation gets its reference values.

| Notebook | What it establishes |
| --- | --- |
| `01-read-strix-product` | Read the delivered metadata against both shipped standards, the orbit state vectors and the raster headers; plot the gamma0 image and the pass geometry |
| `02-acquisition-geometry-3d` | Reconstruct the viewing geometry in 3D from the orbit alone, and check the derived angles against the delivered ones |
| `03-tle-ground-track` | Propagate the constellation's TLEs with the Python `sgp4` reference, plot the ground tracks, and measure the public orbit against the product's own precise ephemeris |
| `04-access-windows` | Compute access windows over a horizon for every satellite and target, draw the planning timeline, and size the work the Go service has to do |

Notebooks 03 and 04 have a second job: they are the oracle. The product ships its own precise ECEF state vectors, so TLE-derived positions can be differenced against the operator's real ephemeris over the same 10-minute arc, in metres. That gives an honest error figure for SGP4-from-TLE rather than an assertion, and the Go propagation code is then tested against the same fixtures. Checking orbit math against two independent sources — a Python reference implementation and the satellite's own definitive orbit — is the difference between code that runs and code worth letting near a plan.

## Repository layout

```
.
├── backend/
│   ├── cmd/
│   │   ├── scene-service/       # :8080 - catalog, the browser's entry point
│   │   └── flightdyn-service/   # :8081 - SGP4, ground tracks, access windows
│   ├── internal/
│   │   ├── domain/              # scene, satellite, target, access, geometry
│   │   ├── usecase/             # catalog, ground track, the access fan-out
│   │   ├── port/                # repository + propagator interfaces
│   │   ├── adapter/
│   │   │   ├── httpapi/         # handlers, routing, error mapping, contract test
│   │   │   ├── wire/            # the JSON shapes, hand-written
│   │   │   ├── repo/            # file-backed; bigquery/gcs would sit here
│   │   │   ├── sgp4/            # the SGP4 library behind port.Propagator
│   │   │   └── flightdyn/       # scene-service's client for flightdyn-service
│   │   └── infra/               # config, logging, graceful shutdown
│   └── testdata/scenes.json     # seed catalog: 1 real scene + 11 synthetic
├── frontend/
│   ├── src/
│   │   ├── interfaces/          # wire types, domain types, UI state - no logic
│   │   ├── lib/                 # api client, mapping, Deck.gl layer factories,
│   │   │                        # timeline geometry, colours, formatters
│   │   └── components/          # every UI component, plus two hooks
├── notebooks/                   # 01-04, committed with outputs
├── fixtures/                    # TLE snapshot + JSON the Go tests assert against
├── requirements.txt             # notebook environment
└── data/                        # gitignored — sample product + manual
```

That is the whole tree. There is no `infra/terraform/`, no `.github/workflows/` and no `frontend/e2e/` yet; they are on the build list below, unchecked.

## Testing strategy

Three levels, because the interesting failures live at different ones.

**Backend.** Table-driven unit tests on `domain` and `usecase` with the ports faked by hand — no cloud, no network, no mocking library, fast. Orbit propagation is checked against the fixtures exported from notebook 03, and the full access sweep reproduces all 219 windows from notebook 04, pair for pair, in the same order. Handlers run through `httptest`; one test starts both services and has one call the other for real. `contract_test.go` pins every JSON field name the frontend reads, which is the hand-rolled stand-in for `buf breaking` described under Architecture.

Every tolerance in those tests is a number that was measured first and then written down, with the measurement in the comment — including the one documenting how far the Go SGP4 library sits from the Python reference, and why that is not hidden. See [backend/README.md](./backend/README.md).

**Frontend units.** Vitest and React Testing Library for state, filters, formatting, and panel behavior.

**The WebGL problem.** A Deck.gl canvas is opaque to DOM assertions — there is nothing to query. Three things are done about it:

- Layer construction is pulled out into pure functions that take scene data and return Deck.gl layer configuration. Those are unit-tested directly, which covers most of what can actually break.
- The canvas is not the only way in. Every footprint on the map is also a row in a keyboard-reachable scene list in the metadata panel, and every timeline bar is a focusable element with its own label, so the DOM tests reach the same selections an operator does.
- Not done, and named rather than hidden: the assembled app in a real browser. Playwright driving the DOM around the canvas, and `onAfterRender` plus a fixed camera for screenshot regression, are on the build list below.

## Running it locally

Prerequisites: Go 1.24+, Node 20+, Python 3.11+. No code generation, no `buf`.

Or, with only Docker installed:

```sh
docker compose up --build        # then open http://localhost:8088
```

That path exists for two reasons: a reviewer with neither Go nor Node can still run the whole
thing, and Cloud Run deploys containers and nothing else, so the images are on the critical path
regardless. Development does not go through it — `go run` rebuilds in a second and Vite
hot-reloads, and a container rebuild in that loop buys nothing.

Three terminals:

```sh
cd backend  && go run ./cmd/flightdyn-service    # :8081 - start this one first
cd backend  && go run ./cmd/scene-service        # :8080
cd frontend && npm install && npm run dev        # :5173, proxies /api to :8080
```

None of that needs GCP credentials: both services read `fixtures/` and `backend/testdata/`. Pointing them at real Cloud Storage and BigQuery would be a new repository implementation behind the ports that already exist.

```sh
cd backend  && go build ./... && go vet ./... && go test ./...
cd frontend && npm run typecheck && npm test -- --run
cd backend  && go test -race ./...               # needs cgo and a C compiler; see backend/README.md
# the live test needs both services up, and VITE_API_BASE because vitest has no dev-server proxy
cd frontend && LIVE_BACKEND=1 VITE_API_BASE=http://localhost:8080/api/v1 npm test -- --run src/live.integration.test.ts
jupyter lab notebooks/
```

## Deployment

Three Cloud Run services in `asia-northeast1`, provisioned by Terraform in `infra/terraform/`.
All three scale to zero and allocate CPU only while a request is in flight, so an idle day costs
nothing and the images sit inside Artifact Registry's free tier.

`web` and `scene-service` are public. `flightdyn-service` is not: it accepts only the runtime
service account, and `scene-service` proves it is that account with an identity token fetched
from the Cloud Run metadata server on each call.

That last part was not the first design. `flightdyn-service` originally used internal-only
ingress, on the assumption that one Cloud Run service calling another stays inside Google's
network. It does not — a call over a `run.app` URL is external traffic, and internal ingress
answered it with a 404. Making that route genuinely internal would mean Direct VPC egress and a
subnet, which is a lot of infrastructure for two services. Moving the control from the network to
IAM costs about twenty lines in the client and is the shape Cloud Run is designed around.

```sh
cd infra/terraform
terraform apply -target=google_artifact_registry_repository.images   # registry first
../../scripts/push-images.sh                                        # Cloud Run needs the images
terraform apply                                                     # then the services
```

The two passes are not ceremony: Cloud Run will not create a service whose image does not exist
yet, and Terraform cannot push one.

## Build status

The repo is being built in public and is early. Nothing below is claimed as working until it is checked off.

- [x] Sample product and Format Manual acquired
- [x] Scope, architecture, and stack decided
- [x] Python environment pinned (`requirements.txt`, `.venv`)
- [x] Notebooks 01–02: product read, geometry derived and cross-checked in 3D
- [x] Notebooks 03–04: SGP4 ground tracks, access windows, fixtures exported
- [x] JSON/HTTP contract defined and pinned by a contract test (protobuf deliberately not used - see Architecture)
- [x] `scene-service`: domain, usecases, HTTP handlers, file-backed repositories
- [x] `flightdyn-service`: SGP4 propagation, ground track, access windows, `errgroup` fan-out
- [x] Frontend: Deck.gl map with footprints, ground tracks and the product sheet
- [x] D3-scaled timeline of acquisition opportunities
- [ ] Ground-station passes on the timeline
- [ ] Server-streamed access windows (not needed at this scale - see Concurrency)
- [ ] BigQuery and GCS repositories behind the existing ports
- [x] Dockerfiles and `docker compose up` for the whole stack
- [x] GitHub Actions: gofmt, vet, `go test -race`, typecheck, vitest, image build
- [x] Terraform, Artifact Registry, Cloud Run, service-to-service auth by ID token
- [ ] Playwright suite and visual regression
- [x] Deployed link

## What this project exercises

Honestly, including where it falls short.

| Area | Where it shows up |
| --- | --- |
| Go backend services | Two services, `backend/`, layered and tested |
| RESTful API, microservices | Two services, JSON over HTTP, the service-to-service call behind an interface, the contract pinned by test |
| Clean Architecture | `domain` / `usecase` / `port` / `adapter` / `infra`, dependencies inward only |
| Concurrency patterns | `errgroup` fan-out bounded to `NumCPU`, results indexed by pair, context cancellation |
| Modern frontend | React 19, TypeScript in strict mode, Vite, a hand-written typed fetch client |
| Data visualization | Deck.gl and WebGL layers, D3 timeline |
| Satellite visualization from TLE | SGP4 ground tracks and access windows, verified against a Python reference |
| UI testing strategy | Layer construction pulled into pure functions and unit-tested directly; Vitest and React Testing Library; browser-level e2e not yet written |
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
