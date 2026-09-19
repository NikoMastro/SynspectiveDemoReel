# backend

Two Go services behind the StriX Scene Explorer console.

| Service | Port | Owns |
| --- | --- | --- |
| `scene-service` | 8080 | the scene catalog, the constellation, the standing targets — the only service the browser talks to |
| `flightdyn-service` | 8081 | SGP4 propagation, ground tracks, access windows |

The split is not decorative. Propagation is CPU-bound and fans out over satellite × target pairs; the catalog is a lookup. They have different shapes and would scale differently, so they are different processes, and `scene-service` reaches `flightdyn-service` over HTTP behind the `port.FlightDynamics` interface.

## Running it

From this directory, with no environment set:

```sh
go run ./cmd/flightdyn-service   # :8081
go run ./cmd/scene-service       # :8080, in a second terminal
```

Both read `../fixtures/tle_strix.txt`; `scene-service` also reads `testdata/scenes.json`. Start `flightdyn-service` first, or the ground-track and access-window endpoints will answer 500 until it is up.

```sh
go build ./...
go vet ./...
go test ./...
go test ./... -v            # the tolerance measurements are printed with t.Logf
go test -race ./...         # needs cgo and a C compiler on PATH
```

`-race` is the honest check on the access fan-out, and it is listed here rather
than in the main command because it has not run on the machine this was written
on: the race detector needs cgo, and there is no `gcc` on this Windows box. What
is checked on every run instead is that the sweep with `MaxParallel=1` produces
a byte-identical result to the sweep across all cores — which catches a wrong
answer from the concurrency, though not a benign-looking data race.

## Configuration

Every setting has a default that works from this directory.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SCENE_PORT` | `:8080` | scene-service listen address |
| `FLIGHTDYN_PORT` | `:8081` | flightdyn-service listen address |
| `SCENE_FILE` | `testdata/scenes.json` | seed catalog |
| `TLE_FILE` | `../fixtures/tle_strix.txt` | cached Celestrak TLEs |
| `FLIGHTDYN_URL` | `http://localhost:8081` | where scene-service looks for flightdyn-service |
| `OFF_NADIR_MIN_DEG` | `20` | lower steering limit — **an assumption**, see below |
| `OFF_NADIR_MAX_DEG` | `45` | upper steering limit — **an assumption** |
| `ALLOWED_ORIGIN` | `*` | CORS origin; `*` is for local development only |

## Endpoints

All `GET`, everything under `/api/v1` except the probe. JSON throughout, with one
exception noted below: the quicklook, which is a PNG.

### scene-service, `:8080`

| Endpoint | Returns |
| --- | --- |
| `/healthz` | `{"status":"ok","service":"scene-service"}` |
| `/api/v1/scenes` | the catalog, newest first, with `count`. Optional `?mode=`, `?polarization=`, `?orbit=`, all case-insensitive |
| `/api/v1/scenes/{id}` | one scene with its full metadata, or 404. The `quicklook` block is where its preview sits, or null for a synthetic scene |
| `/api/v1/scenes/{id}/quicklook.png` | the rendered preview of a delivered product, as PNG with a day of cache. 404 for a scene that has none - the one endpoint here that is not JSON |
| `/api/v1/satellites` | the 8 StriX with epoch, inclination, RAAN, eccentricity, period, mean altitude, orbit family and their TLE lines |
| `/api/v1/targets` | the standing ground targets, so the UI does not hard-code them |
| `/api/v1/ground-track?sat=STRIX-3&minutes=100&step=20` | proxied to flightdyn-service |
| `/api/v1/access-windows?targets=aso,tokyo&days=3` | target ids resolved here, then proxied |

### flightdyn-service, `:8081`

| Endpoint | Returns |
| --- | --- |
| `/healthz` | `{"status":"ok","service":"flightdyn-service"}` |
| `/api/v1/ground-track?sat=&minutes=&step=&start=` | subsatellite latitude, longitude, altitude and speed at each step |
| `/api/v1/access-windows?targets=&days=&step=&start=` | the windows, plus the steering envelope they were computed under |

`start` is optional everywhere and defaults to now; it takes RFC 3339, e.g. `2026-09-19T00:00:00Z`.

An access-window response carries an `assumptions` block — `off_nadir_min_deg`, `off_nadir_max_deg`, `earth_model`, `frame` and `note` — alongside the windows, because the windows mean nothing without the assumption that produced them.

```sh
curl -s 'localhost:8080/api/v1/scenes?mode=Stripmap' | jq '.count'
curl -s 'localhost:8080/api/v1/ground-track?sat=STRIX-3&minutes=100&step=20' | jq '.points | length'
curl -s 'localhost:8080/api/v1/access-windows?targets=aso,tokyo&days=1&start=2026-09-19T00:00:00Z' | jq '.windows | length'
curl -s 'localhost:8080/api/v1/access-windows?targets=aso&days=1' | jq '.assumptions'
```

## Layout

```
cmd/
  scene-service/          wiring and startup only
  flightdyn-service/
internal/
  domain/                 Scene, Satellite, Target, AccessWindow, and the geometry.
                          Imports nothing from this project.
  port/                   the interfaces the use cases need. Imports domain.
  usecase/                Catalog, GroundTrack, AccessWindows. Imports domain + port.
  adapter/
    httpapi/              net/http handlers, routing, query parsing, error mapping
    wire/                 the JSON shapes the two services exchange
    repo/                 file-backed SceneRepository, SatelliteRepository, TargetRepository
    sgp4/                 the SGP4 library behind port.Propagator
    flightdyn/            scene-service's HTTP client for flightdyn-service
  infra/                  config from the environment, logging, graceful shutdown
  testfixture/            finds fixtures/ from inside any test
testdata/scenes.json      the seed catalog
testdata/quicklook/       the real scene's preview PNG, named by scenes.json and read at startup
```

Dependencies point inward. `domain` knows nothing about HTTP, JSON or SGP4; adapters depend on ports, never the reverse. The practical payoff shows up in the tests: `stubFlightDyn` in `httpapi` and `oneSatellite` in `usecase` are twenty lines of hand-written fake each, and there is no mocking library anywhere.

Three dependencies, and that is the whole list:

- `github.com/joshuaferrara/go-satellite` — SGP4
- `golang.org/x/sync/errgroup` — bounded concurrency
- the standard library for everything else. `net/http`, `encoding/json`, `log/slog`. Go 1.22's `ServeMux` matches `GET /api/v1/scenes/{id}` natively, so there is no router library.

## Two things worth reading before the code

### The off-nadir envelope is an assumption

20–45 degrees is **not** from the SAR Data Product Format Manual. The manual is a file format specification: it says where the off-nadir angle is written in each product and in what units, but it does not publish the spacecraft's steering envelope. The one hard number is 31.94 degrees, from the delivered StriX-3 sample product, which sits comfortably inside any plausible range.

Notebook 04 makes the same assumption with the same two numbers, which is the only reason the Go results can be compared against its fixture. Both ends are environment variables; anyone holding the real figures changes two values and every window updates.

### The SGP4 library is 1.7–7.5 km from the Python reference, and the tests say so

`TestSGP4AgainstPythonReference` asserts a 3-order-of-magnitude-looser bound than a propagation test should need, and the comment above it explains why at length. Short version:

`go-satellite` truncates the TLE epoch to a whole second (`helpers.go`, `TLEToSat`, `JDay(..., int(sec))` where `sec` arrives as a float). Every propagation therefore starts from an epoch up to one second early and lands up to one second of orbital motion — about 7.6 km — down-track. It is a fixed per-TLE offset, not noise, and `TestSGP4DeviationIsTheTruncatedTLEEpoch` proves it: divide the position error by the orbital speed and you get back the discarded fraction of a second, over all 40 cases, to under a millisecond.

It is not the gravity model (WGS72, WGS72Old and WGS84 land within 12 m of each other) and it is not the frame rotation (`GSTimeFromDate` matches the notebook's IAU-1982 GMST to 8e-12 rad, which `TestGMSTMatchesReference` pins down separately).

The library is kept anyway. The workaround would mean reproducing its internal epoch arithmetic to know how far to shift the request, which is fragile code resting on an unexported detail. A known, measured, signed error is worth more than an unmaintainable correction — and for planning-grade output, window edges good to about a second, it is tolerable. For anything that points a real antenna it would not be, which is exactly why the test says the number out loud.

The same limitation has a second effect: the library only accepts whole seconds, so the bisection that refines window edges stops once its bracket is one second wide. Halving further would return the identical state.

## Tests

| Test | What it establishes |
| --- | --- |
| `domain.TestOffNadirAndElevation` | the four access-geometry measurements against notebook 04's own `geometry()`, to 1e-6 degrees |
| `domain.TestHorizonCheckIsWhatRejectsTheFarSide` | the horizon check catching a target 67 degrees below the limb that the angle band would have accepted |
| `domain.TestECEFVelocityNeedsOmegaCrossR` | the `omega × r` subtraction, and that skipping it is badly wrong rather than subtly wrong |
| `domain.TestGeodeticRoundTrip` | the ellipsoid conversion and its iterative inverse, pole to pole |
| `sgp4.TestSGP4AgainstPythonReference` | how far the Go library is from python-sgp4, measured and reported every run |
| `sgp4.TestSGP4DeviationIsTheTruncatedTLEEpoch` | *why* it is that far |
| `sgp4.TestGMSTMatchesReference` | sidereal time to 1e-9 rad, isolating the frame rotation from the propagator |
| `repo.TestLoadTLEFile` | fixed-column TLE parsing, and derived period and altitude against notebook 03's fleet table |
| `usecase.TestAccessWindowEdges` | eight fixture windows re-computed, edges within a measured 1.41 s |
| `usecase.TestAccessWindowsRespectContextCancellation` | the cancellation path the fan-out exists for |
| `httpapi.*` | every endpoint through `httptest`, with the service boundary stubbed |
| `flightdyn.TestClient*` | the real boundary: both services, over HTTP, including error mapping |

Every tolerance in these tests is a number that was measured and then written down, with the measurement in the comment. Where a bound is loose, the comment says how loose and why, rather than leaving a reader to assume it is tight.
