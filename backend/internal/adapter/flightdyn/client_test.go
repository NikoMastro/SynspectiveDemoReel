package flightdyn_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/flightdyn"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/httpapi"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/sgp4"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/testfixture"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/usecase"
)

// startFlightDyn runs a real flightdyn-service on a test port and returns a
// client pointed at it.
//
// This is the one test that exercises the service boundary for real: request
// encoding, HTTP, JSON decoding and error mapping all run. Everything else
// stubs the boundary out, which is fine as long as something somewhere proves
// the two halves actually fit together.
func startFlightDyn(t *testing.T) *flightdyn.Client {
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
		Log:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	ts := httptest.NewServer(server.Handler("*"))
	t.Cleanup(ts.Close)

	return flightdyn.New(ts.URL, "", 30*time.Second)
}

func TestClientGroundTrack(t *testing.T) {
	client := startFlightDyn(t)

	points, err := client.GroundTrack(context.Background(), port.GroundTrackRequest{
		Satellite: "STRIX-3",
		Start:     time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC),
		Minutes:   20,
		StepS:     60,
	})
	if err != nil {
		t.Fatalf("ground track: %v", err)
	}

	if want := 20*60/60 + 1; len(points) != want {
		t.Fatalf("got %d points, want %d", len(points), want)
	}
	if points[0].AltitudeKm < 400 || points[0].AltitudeKm > 700 {
		t.Errorf("altitude %.1f km did not survive the round trip", points[0].AltitudeKm)
	}
	// Times come back as RFC 3339 strings and have to parse back to the same
	// instants, one step apart.
	if gap := points[1].Time.Sub(points[0].Time); gap != time.Minute {
		t.Errorf("samples are %s apart, want 1m", gap)
	}
}

func TestClientAccessWindows(t *testing.T) {
	client := startFlightDyn(t)

	result, err := client.AccessWindows(context.Background(), port.AccessRequest{
		Targets: []domain.Target{{ID: "aso", Name: "Mt. Aso, JP", LatDeg: 32.887635, LonDeg: 131.092252}},
		Start:   time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC),
		Days:    0.5,
		StepS:   20,
	})
	if err != nil {
		t.Fatalf("access windows: %v", err)
	}

	if len(result.Windows) == 0 {
		t.Fatal("half a day over Mt. Aso with eight satellites should produce windows")
	}
	if result.Envelope.MinDeg != domain.DefaultOffNadirMinDeg || result.Envelope.MaxDeg != domain.DefaultOffNadirMaxDeg {
		t.Errorf("the envelope did not come back with the windows: %+v", result.Envelope)
	}
	for _, w := range result.Windows {
		if w.TargetID != "aso" {
			t.Errorf("window for the wrong target: %q", w.TargetID)
		}
		if !w.End.After(w.Start) {
			t.Errorf("window ends before it starts: %+v", w)
		}
	}
}

// TestClientMapsRemoteErrors checks the part that is easy to get wrong: a 404
// from the other service has to stay a 404 rather than becoming a 500 by the
// time it reaches the browser.
func TestClientMapsRemoteErrors(t *testing.T) {
	client := startFlightDyn(t)
	ctx := context.Background()

	t.Run("unknown satellite stays a not-found", func(t *testing.T) {
		_, err := client.GroundTrack(ctx, port.GroundTrackRequest{
			Satellite: "STRIX-99", Start: time.Now().UTC(), Minutes: 10, StepS: 60,
		})

		var notFound port.NotFoundError
		if !errors.As(err, &notFound) {
			t.Fatalf("expected port.NotFoundError, got %v", err)
		}
	})

	t.Run("out-of-range request stays a bad request", func(t *testing.T) {
		_, err := client.AccessWindows(ctx, port.AccessRequest{
			Targets: []domain.Target{{ID: "aso"}},
			Start:   time.Now().UTC(),
			Days:    999,
			StepS:   20,
		})

		var invalid port.InvalidRequestError
		if !errors.As(err, &invalid) {
			t.Fatalf("expected port.InvalidRequestError, got %v", err)
		}
	})
}

// TestClientRespectsCancellation checks that cancelling upstream stops the call
// rather than waiting for the sweep to finish.
func TestClientRespectsCancellation(t *testing.T) {
	client := startFlightDyn(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.AccessWindows(ctx, port.AccessRequest{
		Targets: []domain.Target{{ID: "aso"}},
		Start:   time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC),
		Days:    3,
		StepS:   20,
	})
	if err == nil {
		t.Fatal("expected the cancelled context to fail the call")
	}
}
