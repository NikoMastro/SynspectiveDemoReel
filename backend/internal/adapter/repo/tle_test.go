package repo_test

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/testfixture"
)

// TestLoadTLEFile checks the fixed-column parsing against values read straight
// off the cached Celestrak file, and the derived orbit size against notebook
// 03's fleet table.
//
// The expected altitudes and periods are the two-body values the notebook
// prints, so this test is also the check that OrbitSizeFromMeanMotion agrees
// with the analysis rather than with itself.
func TestLoadTLEFile(t *testing.T) {
	fleet, err := repo.LoadTLEFile(testfixture.Path(t, "tle_strix.txt"))
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	all, err := fleet.All(context.Background())
	if err != nil {
		t.Fatalf("all: %v", err)
	}
	if len(all) != 8 {
		t.Fatalf("expected 8 satellites, got %d", len(all))
	}

	// Sorted by name, so the frontend's list is stable between restarts.
	for i := 1; i < len(all); i++ {
		if all[i].Name < all[i-1].Name {
			t.Errorf("satellites are not sorted by name at index %d", i)
		}
	}

	cases := []struct {
		name               string
		norad              int
		inclinationDeg     float64
		raanDeg            float64
		eccentricity       float64
		periodMinutes      float64 // notebook 03's fleet table
		meanAltitudeKm     float64 // notebook 03's fleet table
		epochUTC           string
		wantNearPolarOrbit bool
	}{
		// 1 53815U 22113A   26261.25472743 ... 2 53815  97.4388 325.1536 0002292 ... 15.43734873
		{"STRIX-1", 53815, 97.4388, 325.1536, 0.0002292, 93.28, 435.1, "2026-09-18T06:06:48Z", true},
		// 1 59224U 24047A   26261.19537414 ... 2 59224  97.6725 238.3792 0014712 ... 15.20624473
		{"STRIX-3", 59224, 97.6725, 238.3792, 0.0014712, 94.70, 504.0, "2026-09-18T04:41:20Z", true},
		// 1 60352U 24137A   26261.07541936 ... 2 60352  43.0143 115.4554 0017646 ... 15.35282044
		{"STRIX-4", 60352, 43.0143, 115.4554, 0.0017646, 93.79, 460.1, "2026-09-18T01:48:36Z", false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sat, err := fleet.ByName(context.Background(), c.name)
			if err != nil {
				t.Fatalf("by name: %v", err)
			}

			if sat.NoradID != c.norad {
				t.Errorf("NORAD id %d, want %d", sat.NoradID, c.norad)
			}
			if sat.InclinationDeg != c.inclinationDeg {
				t.Errorf("inclination %.4f, want %.4f", sat.InclinationDeg, c.inclinationDeg)
			}
			if sat.RAANDeg != c.raanDeg {
				t.Errorf("RAAN %.4f, want %.4f", sat.RAANDeg, c.raanDeg)
			}
			if math.Abs(sat.Eccentricity-c.eccentricity) > 1e-12 {
				t.Errorf("eccentricity %.7f, want %.7f", sat.Eccentricity, c.eccentricity)
			}
			if math.Abs(sat.PeriodMinutes-c.periodMinutes) > 0.01 {
				t.Errorf("period %.4f min, want %.2f", sat.PeriodMinutes, c.periodMinutes)
			}
			if math.Abs(sat.MeanAltitudeKm-c.meanAltitudeKm) > 0.1 {
				t.Errorf("mean altitude %.2f km, want %.1f", sat.MeanAltitudeKm, c.meanAltitudeKm)
			}
			if got := sat.EpochUTC.UTC().Format(time.RFC3339); got != c.epochUTC {
				t.Errorf("epoch %s, want %s", got, c.epochUTC)
			}
			if isNearPolar := sat.Family() == "near-polar"; isNearPolar != c.wantNearPolarOrbit {
				t.Errorf("orbit family %s, want near-polar = %v", sat.Family(), c.wantNearPolarOrbit)
			}
		})
	}

	t.Run("lookup is case insensitive", func(t *testing.T) {
		if _, err := fleet.ByName(context.Background(), "  strix-3 "); err != nil {
			t.Errorf("expected a case-insensitive, trimmed lookup to succeed: %v", err)
		}
	})

	t.Run("an unknown name is a NotFoundError", func(t *testing.T) {
		_, err := fleet.ByName(context.Background(), "STRIX-99")

		var notFound port.NotFoundError
		if !errors.As(err, &notFound) {
			t.Fatalf("expected port.NotFoundError, got %v", err)
		}
	})
}

// TestLoadTLEFileRejectsBadInput checks that a broken file stops the service at
// startup rather than producing nonsense orbits at request time.
func TestLoadTLEFileRejectsBadInput(t *testing.T) {
	if _, err := repo.LoadTLEFile(testfixture.BackendPath(t, "testdata/no-such-file.txt")); err == nil {
		t.Error("expected an error for a missing file")
	}
}

// TestTargets checks the standing target catalog, including that a typo is an
// error rather than a quietly shorter answer.
func TestTargets(t *testing.T) {
	targets := repo.NewTargets()
	ctx := context.Background()

	all, err := targets.All(ctx)
	if err != nil {
		t.Fatalf("all: %v", err)
	}
	if len(all) != 4 {
		t.Fatalf("expected the 4 targets notebook 04 swept, got %d", len(all))
	}

	t.Run("resolves ids", func(t *testing.T) {
		got, err := targets.ByIDs(ctx, []string{"tokyo", "ASO"})
		if err != nil {
			t.Fatalf("by ids: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("expected 2 targets, got %d", len(got))
		}
		// Sorted, so the same request always produces the same response.
		if got[0].ID != "aso" || got[1].ID != "tokyo" {
			t.Errorf("expected a stable sorted order, got %s then %s", got[0].ID, got[1].ID)
		}
	})

	t.Run("a typo is an error, not a silent omission", func(t *testing.T) {
		_, err := targets.ByIDs(ctx, []string{"aso", "tokio"})

		var notFound port.NotFoundError
		if !errors.As(err, &notFound) {
			t.Fatalf("expected port.NotFoundError, got %v", err)
		}
	})
}
