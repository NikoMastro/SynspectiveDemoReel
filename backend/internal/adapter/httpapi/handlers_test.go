package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/httpapi"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/sgp4"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/wire"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/testfixture"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/usecase"
)

// quietLogger keeps the test output readable. The handlers log every request;
// discarding it here means a failure shows the assertion, not fifty log lines.
func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// stubFlightDyn stands in for flightdyn-service so the scene-service handlers
// can be tested without a second process. This is what the port.FlightDynamics
// interface is for: the stub is twenty lines and there is no mocking library.
type stubFlightDyn struct {
	track   []domain.GroundTrackPoint
	windows []domain.AccessWindow
	err     error

	// gotRequest records what the handler forwarded, so the test can check the
	// query was parsed and passed through rather than quietly defaulted.
	gotTrackRequest  port.GroundTrackRequest
	gotAccessRequest port.AccessRequest
}

func (s *stubFlightDyn) GroundTrack(_ context.Context, req port.GroundTrackRequest) ([]domain.GroundTrackPoint, error) {
	s.gotTrackRequest = req
	return s.track, s.err
}

func (s *stubFlightDyn) AccessWindows(_ context.Context, req port.AccessRequest) (port.AccessResult, error) {
	s.gotAccessRequest = req
	return port.AccessResult{Windows: s.windows, Envelope: domain.DefaultEnvelope()}, s.err
}

func newSceneServer(t *testing.T, flightDyn port.FlightDynamics) http.Handler {
	t.Helper()

	scenes, err := repo.LoadSceneFile(testfixture.BackendPath(t, "testdata/scenes.json"))
	if err != nil {
		t.Fatalf("load scenes: %v", err)
	}
	satellites, err := repo.LoadTLEFile(testfixture.Path(t, "tle_strix.txt"))
	if err != nil {
		t.Fatalf("load TLEs: %v", err)
	}

	server := &httpapi.SceneServer{
		Catalog:   usecase.NewCatalog(scenes, satellites, repo.NewTargets()),
		FlightDyn: flightDyn,
		Log:       quietLogger(),
	}
	return server.Handler("*")
}

func newFlightDynServer(t *testing.T) http.Handler {
	t.Helper()

	satellites, err := repo.LoadTLEFile(testfixture.Path(t, "tle_strix.txt"))
	if err != nil {
		t.Fatalf("load TLEs: %v", err)
	}
	propagator := sgp4.New()

	server := &httpapi.FlightDynServer{
		GroundTrack: usecase.NewGroundTrack(satellites, propagator),
		Access:      usecase.NewAccessWindows(satellites, propagator, domain.DefaultEnvelope()),
		Targets:     repo.NewTargets(),
		Log:         quietLogger(),
	}
	return server.Handler("*")
}

// get issues a request against a handler and returns the recorder.
func get(handler http.Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

// decode unmarshals a JSON response body, failing the test if it is not JSON.
func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()

	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("response body is not the expected JSON: %v\nbody: %s", err, rec.Body.String())
	}
	return v
}

func requireStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status %d, want %d\nbody: %s", rec.Code, want, rec.Body.String())
	}
}

func TestHealthz(t *testing.T) {
	for _, c := range []struct {
		name    string
		handler http.Handler
		want    string
	}{
		{"scene-service", newSceneServer(t, &stubFlightDyn{}), "scene-service"},
		{"flightdyn-service", newFlightDynServer(t), "flightdyn-service"},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := get(c.handler, "/healthz")
			requireStatus(t, rec, http.StatusOK)

			body := decode[wire.Health](t, rec)
			if body.Status != "ok" || body.Service != c.want || body.Version == "" {
				t.Errorf("got %+v", body)
			}
		})
	}
}

func TestListScenes(t *testing.T) {
	handler := newSceneServer(t, &stubFlightDyn{})

	t.Run("unfiltered", func(t *testing.T) {
		rec := get(handler, "/api/v1/scenes")
		requireStatus(t, rec, http.StatusOK)

		body := decode[wire.ScenesResponse](t, rec)
		if body.Count != len(body.Scenes) {
			t.Errorf("count %d does not match %d scenes", body.Count, len(body.Scenes))
		}
		if body.Count < 2 {
			t.Fatalf("expected the seed catalog, got %d scenes", body.Count)
		}

		// Newest first, and exactly one real scene. Both are promises the
		// frontend relies on: it labels the synthetic ones.
		for i := 1; i < len(body.Scenes); i++ {
			if body.Scenes[i].AcquiredUTC.After(body.Scenes[i-1].AcquiredUTC) {
				t.Errorf("scenes are not newest first at index %d", i)
			}
		}
		real := 0
		for _, s := range body.Scenes {
			if !s.Synthetic {
				real++
			}
		}
		if real != 1 {
			t.Errorf("expected exactly one real scene in the catalog, got %d", real)
		}
	})

	t.Run("filters", func(t *testing.T) {
		cases := []struct {
			name  string
			query string
			check func(wire.Scene) bool
		}{
			{"by mode", "?mode=Stripmap", func(s wire.Scene) bool { return s.ImagingMode == "Stripmap" }},
			{"by polarization", "?polarization=HH", func(s wire.Scene) bool { return s.Polarization == "HH" }},
			{"by orbit", "?orbit=Ascending", func(s wire.Scene) bool { return s.PassDirection == "Ascending" }},
			// Filters are case-insensitive because a query string is typed by a
			// human or built from a URL someone edited.
			{"case insensitive", "?mode=stripmap", func(s wire.Scene) bool { return s.ImagingMode == "Stripmap" }},
		}

		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				rec := get(handler, "/api/v1/scenes"+c.query)
				requireStatus(t, rec, http.StatusOK)

				body := decode[wire.ScenesResponse](t, rec)
				if body.Count == 0 {
					t.Fatal("filter matched nothing, so it proves nothing")
				}
				for _, s := range body.Scenes {
					if !c.check(s) {
						t.Errorf("scene %s does not match the filter", s.ID)
					}
				}
			})
		}
	})

	t.Run("a filter that matches nothing returns an empty list, not an error", func(t *testing.T) {
		rec := get(handler, "/api/v1/scenes?mode=NoSuchMode")
		requireStatus(t, rec, http.StatusOK)

		body := decode[wire.ScenesResponse](t, rec)
		if body.Count != 0 {
			t.Errorf("expected 0 scenes, got %d", body.Count)
		}
	})
}

func TestGetScene(t *testing.T) {
	handler := newSceneServer(t, &stubFlightDyn{})

	t.Run("the real Mt. Aso scene", func(t *testing.T) {
		rec := get(handler, "/api/v1/scenes/STRIX3-20260615T063527Z-SL1")
		requireStatus(t, rec, http.StatusOK)

		scene := decode[wire.Scene](t, rec)
		if scene.Synthetic {
			t.Error("the Mt. Aso scene is the real one and must not be flagged synthetic")
		}
		if scene.OffNadirDeg != 31.94 || scene.Polarization != "VV" || scene.ImagingMode != "SlidingSpotlight" {
			t.Errorf("delivered metadata did not survive the round trip: %+v", scene)
		}
		if len(scene.Footprint) < 4 {
			t.Errorf("expected a footprint ring, got %d points", len(scene.Footprint))
		}
		if scene.NESZdB != nil {
			t.Error("NESZ is not stated for the real scene and must stay null rather than becoming 0")
		}
	})

	t.Run("unknown id is a 404", func(t *testing.T) {
		rec := get(handler, "/api/v1/scenes/NOPE")
		requireStatus(t, rec, http.StatusNotFound)

		body := decode[map[string]string](t, rec)
		if body["error"] == "" {
			t.Error("a 404 should say what was not found")
		}
	})
}

func TestListSatellites(t *testing.T) {
	handler := newSceneServer(t, &stubFlightDyn{})

	rec := get(handler, "/api/v1/satellites")
	requireStatus(t, rec, http.StatusOK)

	body := decode[struct {
		Count      int              `json:"count"`
		Satellites []wire.Satellite `json:"satellites"`
	}](t, rec)

	if body.Count != 8 {
		t.Fatalf("expected the 8 StriX from the cached TLEs, got %d", body.Count)
	}

	for _, s := range body.Satellites {
		// Sanity bounds rather than exact values: the exact numbers belong to
		// the TLE parsing test. What matters here is that the derived fields
		// were computed at all and reached the wire.
		if s.InclinationDeg <= 0 || s.InclinationDeg > 180 {
			t.Errorf("%s: inclination %.3f is not a real inclination", s.Name, s.InclinationDeg)
		}
		if s.PeriodMinutes < 80 || s.PeriodMinutes > 120 {
			t.Errorf("%s: period %.2f min is not a low Earth orbit", s.Name, s.PeriodMinutes)
		}
		if s.MeanAltitudeKm < 300 || s.MeanAltitudeKm > 800 {
			t.Errorf("%s: altitude %.1f km is not a low Earth orbit", s.Name, s.MeanAltitudeKm)
		}
		if s.OrbitFamily != "near-polar" && s.OrbitFamily != "mid-inclination" {
			t.Errorf("%s: unexpected orbit family %q", s.Name, s.OrbitFamily)
		}
	}
}

func TestSceneServiceForwardsToFlightDyn(t *testing.T) {
	t.Run("ground track", func(t *testing.T) {
		stub := &stubFlightDyn{track: []domain.GroundTrackPoint{
			{Time: time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC), LatDeg: 1, LonDeg: 2, AltitudeKm: 500, SpeedKmS: 7.6},
		}}
		handler := newSceneServer(t, stub)

		rec := get(handler, "/api/v1/ground-track?sat=STRIX-3&minutes=50&step=10&start=2026-09-19T00:00:00Z")
		requireStatus(t, rec, http.StatusOK)

		if stub.gotTrackRequest.Satellite != "STRIX-3" ||
			stub.gotTrackRequest.Minutes != 50 ||
			stub.gotTrackRequest.StepS != 10 {
			t.Errorf("the query was not forwarded: %+v", stub.gotTrackRequest)
		}

		body := decode[wire.GroundTrackResponse](t, rec)
		if len(body.Points) != 1 || body.Points[0].AltKm != 500 {
			t.Errorf("the response did not come back intact: %+v", body)
		}
	})

	t.Run("access windows resolve target ids before the hop", func(t *testing.T) {
		stub := &stubFlightDyn{windows: []domain.AccessWindow{{
			Satellite:  "STRIX-3",
			TargetID:   "aso",
			TargetName: "Mt. Aso, JP",
			Start:      time.Date(2026, 9, 19, 1, 0, 0, 0, time.UTC),
			End:        time.Date(2026, 9, 19, 1, 1, 0, 0, time.UTC),
		}}}
		handler := newSceneServer(t, stub)

		rec := get(handler, "/api/v1/access-windows?targets=aso,tokyo&days=2&start=2026-09-19T00:00:00Z")
		requireStatus(t, rec, http.StatusOK)

		if len(stub.gotAccessRequest.Targets) != 2 {
			t.Fatalf("expected 2 resolved targets, got %d", len(stub.gotAccessRequest.Targets))
		}
		for _, target := range stub.gotAccessRequest.Targets {
			if target.LatDeg == 0 && target.LonDeg == 0 {
				t.Errorf("target %q was forwarded without coordinates", target.ID)
			}
		}

		body := decode[wire.AccessWindowsResponse](t, rec)
		if len(body.Windows) != 1 {
			t.Fatalf("expected 1 window, got %d", len(body.Windows))
		}
		if body.Windows[0].DurationS != 60 {
			t.Errorf("duration %.1f s, want 60", body.Windows[0].DurationS)
		}
		// The envelope and its caveat travel with the answer: the windows are
		// meaningless without the assumption that produced them.
		if body.Assumptions.OffNadirMinDeg != 20 || body.Assumptions.OffNadirMaxDeg != 45 ||
			body.Assumptions.Note == "" || body.Assumptions.EarthModel == "" {
			t.Errorf("the steering envelope did not reach the client: %+v", body.Assumptions)
		}
	})

	t.Run("an unknown target is a 404 from the service that owns the names", func(t *testing.T) {
		handler := newSceneServer(t, &stubFlightDyn{})

		rec := get(handler, "/api/v1/access-windows?targets=atlantis")
		requireStatus(t, rec, http.StatusNotFound)
	})
}

func TestBadRequests(t *testing.T) {
	sceneHandler := newSceneServer(t, &stubFlightDyn{})
	flightDynHandler := newFlightDynServer(t)

	cases := []struct {
		name    string
		handler http.Handler
		target  string
	}{
		{"ground track without a satellite", sceneHandler, "/api/v1/ground-track"},
		{"ground track with a non-numeric step", sceneHandler, "/api/v1/ground-track?sat=STRIX-3&step=soon"},
		{"ground track with an unparseable start", sceneHandler, "/api/v1/ground-track?sat=STRIX-3&start=yesterday"},
		{"access windows without targets", sceneHandler, "/api/v1/access-windows"},
		{"ground track beyond the day limit", flightDynHandler, "/api/v1/ground-track?sat=STRIX-3&minutes=99999"},
		{"access windows beyond the horizon limit", flightDynHandler, "/api/v1/access-windows?targets=aso&days=99"},
		{"access windows with an impossible step", flightDynHandler, "/api/v1/access-windows?targets=aso&step=0"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := get(c.handler, c.target)
			requireStatus(t, rec, http.StatusBadRequest)

			body := decode[map[string]string](t, rec)
			if body["error"] == "" {
				t.Error("a 400 should explain what was wrong with the request")
			}
		})
	}

	t.Run("an unknown satellite is a 404", func(t *testing.T) {
		rec := get(flightDynHandler, "/api/v1/ground-track?sat=STRIX-99&minutes=10")
		requireStatus(t, rec, http.StatusNotFound)
	})
}

// TestFlightDynGroundTrackIsReal runs the propagator end to end through the
// handler, so this one is not a stub: it checks that a real SGP4 ground track
// comes back with sensible geography.
func TestFlightDynGroundTrackIsReal(t *testing.T) {
	handler := newFlightDynServer(t)

	rec := get(handler, "/api/v1/ground-track?sat=STRIX-3&minutes=100&step=20&start=2026-09-19T00:00:00Z")
	requireStatus(t, rec, http.StatusOK)

	body := decode[wire.GroundTrackResponse](t, rec)

	// 100 minutes at 20 seconds, inclusive of both ends.
	if want := 100*60/20 + 1; len(body.Points) != want {
		t.Fatalf("got %d points, want %d", len(body.Points), want)
	}

	for _, p := range body.Points {
		if p.LatDeg < -90 || p.LatDeg > 90 || p.LonDeg < -180 || p.LonDeg > 180 {
			t.Fatalf("point outside the globe: %+v", p)
		}
		if p.AltKm < 400 || p.AltKm > 700 {
			t.Fatalf("altitude %.1f km is not this constellation: %+v", p.AltKm, p)
		}
		if p.SpeedKmS < 7 || p.SpeedKmS > 8 {
			t.Fatalf("speed %.3f km/s is not a low Earth orbit: %+v", p.SpeedKmS, p)
		}
	}

	// STRIX-3 is near-polar, so a full revolution has to cross both hemispheres.
	var north, south bool
	for _, p := range body.Points {
		north = north || p.LatDeg > 60
		south = south || p.LatDeg < -60
	}
	if !north || !south {
		t.Error("a near-polar satellite should reach high latitudes in both hemispheres over 100 minutes")
	}
}

// TestFlightDynAccessWindowsEndToEnd runs the real fan-out through the handler
// over a short horizon.
func TestFlightDynAccessWindowsEndToEnd(t *testing.T) {
	handler := newFlightDynServer(t)

	rec := get(handler, "/api/v1/access-windows?targets=aso,tokyo&days=0.25&step=20&start=2026-09-19T00:00:00Z")
	requireStatus(t, rec, http.StatusOK)

	body := decode[wire.AccessWindowsResponse](t, rec)
	if len(body.Targets) != 2 {
		t.Fatalf("expected 2 targets in the response, got %d", len(body.Targets))
	}
	if len(body.Windows) == 0 {
		t.Fatal("six hours over Japan with eight satellites should produce at least one window")
	}

	for i, w := range body.Windows {
		if !w.EndUTC.After(w.StartUTC) {
			t.Errorf("window %d ends before it starts: %+v", i, w)
		}
		if w.BestOffNadirDeg < body.Assumptions.OffNadirMinDeg || w.BestOffNadirDeg > body.Assumptions.OffNadirMaxDeg {
			t.Errorf("window %d reports %.3f deg, outside the %.0f-%.0f envelope it was computed under",
				i, w.BestOffNadirDeg, body.Assumptions.OffNadirMinDeg, body.Assumptions.OffNadirMaxDeg)
		}
		if w.LookSide != "Left" && w.LookSide != "Right" {
			t.Errorf("window %d has look side %q", i, w.LookSide)
		}
		if i > 0 && w.StartUTC.Before(body.Windows[i-1].StartUTC) {
			t.Errorf("windows are not in chronological order at index %d", i)
		}
	}
}
