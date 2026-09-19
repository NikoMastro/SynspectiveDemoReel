package usecase_test

import (
	"context"
	"math"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/sgp4"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/testfixture"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/usecase"
)

// accessFixture is fixtures/access_windows.json, produced by
// notebooks/04-access-windows.ipynb.
type accessFixture struct {
	Assumptions struct {
		OffNadirMinDeg float64 `json:"off_nadir_min_deg"`
		OffNadirMaxDeg float64 `json:"off_nadir_max_deg"`
	} `json:"assumptions"`
	Horizon struct {
		StartUTC    string  `json:"start_utc"`
		Days        float64 `json:"days"`
		CoarseStepS int     `json:"coarse_step_s"`
	} `json:"horizon"`
	Targets map[string]struct {
		LatDeg float64 `json:"lat_deg"`
		LonDeg float64 `json:"lon_deg"`
	} `json:"targets"`
	Windows []fixtureWindow `json:"windows"`
}

// fixtureWindow is one expected access window as notebook 04 recorded it.
type fixtureWindow struct {
	Satellite       string  `json:"satellite"`
	Target          string  `json:"target"`
	StartUTC        string  `json:"start_utc"`
	EndUTC          string  `json:"end_utc"`
	DurationS       float64 `json:"duration_s"`
	BestOffNadirDeg float64 `json:"best_off_nadir_deg"`
	LookSide        string  `json:"look_side"`
	PassDirection   string  `json:"pass_direction"`
}

// oneSatellite is a SatelliteRepository holding a single satellite, so a test
// can sweep one pair instead of the whole constellation. Writing the fake by
// hand is three methods and no mocking framework, which is the payoff for
// having the port in the first place.
type oneSatellite struct{ sat domain.Satellite }

func (r oneSatellite) All(context.Context) ([]domain.Satellite, error) {
	return []domain.Satellite{r.sat}, nil
}

func (r oneSatellite) ByName(_ context.Context, name string) (domain.Satellite, error) {
	if !strings.EqualFold(name, r.sat.Name) {
		return domain.Satellite{}, port.NotFoundError{Message: "satellite " + name + " not found"}
	}
	return r.sat, nil
}

func loadAccessFixture(t *testing.T) accessFixture {
	t.Helper()
	var f accessFixture
	testfixture.LoadJSON(t, "access_windows.json", &f)
	if len(f.Windows) == 0 {
		t.Fatal("access_windows.json has no windows")
	}
	return f
}

func loadFleet(t *testing.T) *repo.TLEFile {
	t.Helper()
	fleet, err := repo.LoadTLEFile(testfixture.Path(t, "tle_strix.txt"))
	if err != nil {
		t.Fatalf("load TLEs: %v", err)
	}
	return fleet
}

func mustParse(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return ts
}

// TestAccessWindowEdges re-computes a handful of windows from
// fixtures/access_windows.json and checks that the Go sweep lands on the same
// edges as the Python one.
//
// ---------------------------------------------------------------------------
// WHY THE TOLERANCE IS 2 SECONDS
//
// The fixture records its edges to the microsecond, and this test cannot ask
// for anything like that. Two independent limits stop it:
//
//  1. The Go SGP4 library is a fixed distance down-track from python-sgp4 —
//     up to 7.5 km, which is up to one second of flight. A window edge is the
//     moment a continuously-moving angle crosses a threshold, so a one-second
//     positional lag moves the crossing by about a second. See
//     TestSGP4DeviationIsTheTruncatedTLEEpoch for where that comes from.
//  2. The same library can only be propagated at whole seconds, so bisection
//     stops once its bracket is one second wide. The edge is located to within
//     a second at best, whatever the loop does after that.
//
// The numbers actually measured over these eight windows, one per satellite,
// are a worst edge gap of 1.41 s and a worst duration gap of 1.55 s. Two
// seconds is the next round number above both, and it is stated here so that
// the bound is visibly derived from a measurement rather than chosen to make
// the test green.
//
// Be clear about what this does and does not establish. It does NOT show the
// two implementations agree to the microsecond; nothing built on this library
// could show that. What it shows is that the Go port finds the SAME windows —
// same satellite, same target, same pass, same look side, same best geometry —
// and places their edges inside the error the propagator already admits to.
// That is a real check on the sweep and the bisection, because a sign error in
// the look side, a missing horizon check or an off-by-one in the coarse scan
// would all miss by far more than two seconds.
//
// The duration gap being slightly LARGER than the edge gap is worth knowing.
// The down-track lag shifts both edges the same way and mostly cancels out of
// the length; what does not cancel is the half-second of rounding at each edge,
// and those two can fall in opposite directions.
// ---------------------------------------------------------------------------
func TestAccessWindowEdges(t *testing.T) {
	const (
		edgeTolerance     = 2 * time.Second
		durationTolerance = 2 * time.Second
		offNadirTolerance = 0.5 // degrees
	)

	fixture := loadAccessFixture(t)
	fleet := loadFleet(t)

	envelope := domain.OffNadirEnvelope{
		MinDeg: fixture.Assumptions.OffNadirMinDeg,
		MaxDeg: fixture.Assumptions.OffNadirMaxDeg,
	}

	horizonStart := mustParse(t, fixture.Horizon.StartUTC)

	// One window per satellite rather than the first few in the file, so that
	// both orbit families, both hemispheres and the Arctic target are exercised.
	selected := pickWindows(t, fixture, []string{
		"STRIX-1", "STRIX-2", "STRIX-3", "STRIX-4", "STRIX-5", "STRIX-6", "STRIX-7", "STRIX-8",
	})

	var worstEdge, worstDuration time.Duration

	for _, w := range selected {
		t.Run(w.Satellite+" over "+w.Target, func(t *testing.T) {
			sat, err := fleet.ByName(context.Background(), w.Satellite)
			if err != nil {
				t.Fatalf("fixture names a satellite the TLE file does not have: %v", err)
			}

			coords := fixture.Targets[w.Target]
			target := domain.Target{ID: "fixture", Name: w.Target, LatDeg: coords.LatDeg, LonDeg: coords.LonDeg}

			wantStart := mustParse(t, w.StartUTC)
			wantEnd := mustParse(t, w.EndUTC)

			// Sweep a short horizon bracketing the expected window. Sweeping all
			// three days here would be half a million propagations for one
			// assertion, so the sweep starts five minutes early — but it starts
			// on the fixture's own 20 second grid, not five minutes before the
			// window to the microsecond.
			//
			// That alignment matters more than it looks. "Best off-nadir" is the
			// smallest angle among the COARSE samples that fall inside the
			// window, not the true minimum of a continuous curve, so a window
			// only 41 seconds long contains two samples and which two depends
			// entirely on the phase of the grid. Sweeping off-grid would compare
			// a different pair of samples and disagree by ten degrees while both
			// answers were correct. Refining the best angle the way the edges
			// are refined would remove the sensitivity; notebook 04 does not do
			// that, so neither does this port.
			step := time.Duration(fixture.Horizon.CoarseStepS) * time.Second
			sweepStart := alignToGrid(wantStart.Add(-5*time.Minute), horizonStart, step)

			windows := sweepAround(t, sat, target, envelope, sweepStart, 15*time.Minute, fixture.Horizon.CoarseStepS)

			got, ok := closestWindow(windows, wantStart)
			if !ok {
				t.Fatalf("no window found near %s", w.StartUTC)
			}

			startGap := absDuration(got.Start.Sub(wantStart))
			endGap := absDuration(got.End.Sub(wantEnd))
			durationGap := absDuration(got.Duration() - time.Duration(w.DurationS*float64(time.Second)))

			if startGap > edgeTolerance {
				t.Errorf("start %s, want %s (off by %s)", got.Start.Format(time.RFC3339Nano), w.StartUTC, startGap)
			}
			if endGap > edgeTolerance {
				t.Errorf("end %s, want %s (off by %s)", got.End.Format(time.RFC3339Nano), w.EndUTC, endGap)
			}
			if durationGap > durationTolerance {
				t.Errorf("duration %s, want %.3f s (off by %s)", got.Duration(), w.DurationS, durationGap)
			}
			if d := math.Abs(got.BestOffNadirDeg - w.BestOffNadirDeg); d > offNadirTolerance {
				t.Errorf("best off-nadir %.4f deg, want %.4f deg", got.BestOffNadirDeg, w.BestOffNadirDeg)
			}
			if string(got.LookSide) != w.LookSide {
				t.Errorf("look side %s, want %s", got.LookSide, w.LookSide)
			}
			if string(got.PassDirection) != w.PassDirection {
				t.Errorf("pass direction %s, want %s", got.PassDirection, w.PassDirection)
			}

			for _, gap := range []time.Duration{startGap, endGap} {
				if gap > worstEdge {
					worstEdge = gap
				}
			}
			if durationGap > worstDuration {
				worstDuration = durationGap
			}
		})
	}

	t.Logf("%d windows re-computed: worst edge gap %s, worst duration gap %s (tolerances %s and %s)",
		len(selected), worstEdge, worstDuration, edgeTolerance, durationTolerance)
}

// TestAccessWindowsRespectContextCancellation checks the cancellation path the
// fan-out exists for: an operator who changes a filter should stop the previous
// sweep, not wait for it.
func TestAccessWindowsRespectContextCancellation(t *testing.T) {
	fleet := loadFleet(t)
	windows := usecase.NewAccessWindows(fleet, sgp4.New(), domain.DefaultEnvelope())

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled before the sweep starts

	_, err := windows.Compute(ctx, port.AccessRequest{
		Targets: []domain.Target{{ID: "aso", Name: "Mt. Aso, JP", LatDeg: 32.887635, LonDeg: 131.092252}},
		Start:   time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC),
		Days:    3,
		StepS:   20,
	})
	if err == nil {
		t.Fatal("expected a cancellation error, got none")
	}
	if !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("expected the context error to surface, got %v", err)
	}
}

// TestAccessWindowsRejectsBadRequests keeps the guard rails honest. These are
// use-case rules, not HTTP rules, which is why they are tested here.
func TestAccessWindowsRejectsBadRequests(t *testing.T) {
	fleet := loadFleet(t)
	windows := usecase.NewAccessWindows(fleet, sgp4.New(), domain.DefaultEnvelope())

	target := domain.Target{ID: "aso", Name: "Mt. Aso, JP", LatDeg: 32.887635, LonDeg: 131.092252}
	start := time.Date(2026, 9, 19, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		req  port.AccessRequest
	}{
		{"no targets", port.AccessRequest{Start: start, Days: 1, StepS: 20}},
		{"zero days", port.AccessRequest{Targets: []domain.Target{target}, Start: start, Days: 0, StepS: 20}},
		{"too many days", port.AccessRequest{Targets: []domain.Target{target}, Start: start, Days: 99, StepS: 20}},
		{"step too small", port.AccessRequest{Targets: []domain.Target{target}, Start: start, Days: 1, StepS: 0}},
		{"step too large", port.AccessRequest{Targets: []domain.Target{target}, Start: start, Days: 1, StepS: 600}},
		{"no start", port.AccessRequest{Targets: []domain.Target{target}, Days: 1, StepS: 20}},

		// The target count multiplies everything else: the sweep is
		// len(satellites) * len(targets) * horizon/step. Without this bound a
		// caller could send the same id hundreds of times and pay for one
		// query string what the service pays for in CPU.
		{"too many targets", port.AccessRequest{Targets: manyTargets(target, 9), Start: start, Days: 1, StepS: 20}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := windows.Compute(context.Background(), c.req); err == nil {
				t.Error("expected an error, got none")
			}
		})
	}
}

// sweepAround runs the real use case over a short horizon for one satellite.
func sweepAround(t *testing.T, sat domain.Satellite, target domain.Target,
	envelope domain.OffNadirEnvelope, start time.Time, span time.Duration, stepS int) []domain.AccessWindow {
	t.Helper()

	windows := usecase.NewAccessWindows(oneSatellite{sat: sat}, sgp4.New(), envelope)
	got, err := windows.Compute(context.Background(), port.AccessRequest{
		Targets: []domain.Target{target},
		Start:   start,
		Days:    span.Seconds() / 86400,
		StepS:   stepS,
	})
	if err != nil {
		t.Fatalf("compute access windows: %v", err)
	}
	return got
}

// closestWindow picks the computed window whose start is nearest the expected
// one. A near-overhead pass produces two windows a couple of minutes apart —
// the target crosses the blind spot directly beneath the satellite — so taking
// the first result would sometimes compare the wrong one.
func closestWindow(windows []domain.AccessWindow, want time.Time) (domain.AccessWindow, bool) {
	var best domain.AccessWindow
	found := false
	for _, w := range windows {
		if !found || absDuration(w.Start.Sub(want)) < absDuration(best.Start.Sub(want)) {
			best, found = w, true
		}
	}
	return best, found
}

// pickWindows takes the first fixture window belonging to each named satellite.
func pickWindows(t *testing.T, f accessFixture, satellites []string) []fixtureWindow {
	t.Helper()

	var picked []fixtureWindow
	for _, name := range satellites {
		for _, w := range f.Windows {
			if w.Satellite == name {
				picked = append(picked, w)
				break
			}
		}
	}
	if len(picked) != len(satellites) {
		t.Fatalf("fixture does not contain a window for every satellite asked for: got %d of %d", len(picked), len(satellites))
	}
	return picked
}

// alignToGrid moves t back to the most recent point on the sweep grid that the
// fixture used, so both implementations sample at the same instants.
func alignToGrid(t, origin time.Time, step time.Duration) time.Time {
	elapsed := t.Sub(origin)
	return origin.Add(elapsed / step * step)
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// TestAccessWindowsReproduceTheWholeFixture is the strongest statement this
// repository can make about the Go port: swept over the same three days, the
// same eight TLEs and the same four targets, it finds the SAME 219 windows
// notebook 04 found, pair for pair, in the same order.
//
// TestAccessWindowEdges checks a handful of windows in detail; this one checks
// that none are missing and none are invented. Those are different failures. A
// sign error in the look side moves an edge; a missing horizon check or an
// off-by-one at a window boundary changes the count.
//
// The sweep is 8 x 4 x 12,961 geometry evaluations, each one an SGP4 call, and
// it finishes in about 70 ms on this machine across the fan-out - which is why
// it runs every time rather than hiding behind a build tag. It then runs the
// SAME sweep with MaxParallel=1 (about 820 ms on 24 cores) and asserts the two
// results are identical, so the log carries both a baseline for the fan-out and
// a check that the concurrency changes the speed and nothing else.
func TestAccessWindowsReproduceTheWholeFixture(t *testing.T) {
	const edgeTolerance = 2 * time.Second

	fixture := loadAccessFixture(t)
	fleet := loadFleet(t)

	targets := make([]domain.Target, 0, len(fixture.Targets))
	for name, coords := range fixture.Targets {
		targets = append(targets, domain.Target{ID: name, Name: name, LatDeg: coords.LatDeg, LonDeg: coords.LonDeg})
	}

	windows := usecase.NewAccessWindows(fleet, sgp4.New(), domain.OffNadirEnvelope{
		MinDeg: fixture.Assumptions.OffNadirMinDeg,
		MaxDeg: fixture.Assumptions.OffNadirMaxDeg,
	})

	started := time.Now()
	got, err := windows.Compute(context.Background(), port.AccessRequest{
		Targets: targets,
		Start:   mustParse(t, fixture.Horizon.StartUTC),
		Days:    fixture.Horizon.Days,
		StepS:   fixture.Horizon.CoarseStepS,
	})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	elapsed := time.Since(started)

	if len(got) != len(fixture.Windows) {
		t.Fatalf("found %d windows, the notebook found %d", len(got), len(fixture.Windows))
	}

	// Both lists are sorted by start time, so index i must be the same
	// opportunity on both sides.
	var worstEdge time.Duration
	for i, want := range fixture.Windows {
		have := got[i]

		if have.Satellite != want.Satellite || have.TargetName != want.Target {
			t.Fatalf("window %d is %s over %s, the notebook has %s over %s",
				i, have.Satellite, have.TargetName, want.Satellite, want.Target)
		}
		if string(have.LookSide) != want.LookSide || string(have.PassDirection) != want.PassDirection {
			t.Errorf("window %d (%s over %s): %s/%s, want %s/%s",
				i, have.Satellite, have.TargetName,
				have.LookSide, have.PassDirection, want.LookSide, want.PassDirection)
		}

		for _, gap := range []time.Duration{
			absDuration(have.Start.Sub(mustParse(t, want.StartUTC))),
			absDuration(have.End.Sub(mustParse(t, want.EndUTC))),
		} {
			if gap > edgeTolerance {
				t.Errorf("window %d (%s over %s): edge off by %s",
					i, have.Satellite, have.TargetName, gap)
			}
			if gap > worstEdge {
				worstEdge = gap
			}
		}
	}

	// The same sweep again with the fan-out turned off. Without this the
	// elapsed time above only says the sweep is fast; beside it, it says the
	// concurrency is why. The serial result must also be identical, which is
	// the other half of "the output order does not depend on who finished
	// first".
	serialWindows := usecase.NewAccessWindows(fleet, sgp4.New(), domain.OffNadirEnvelope{
		MinDeg: fixture.Assumptions.OffNadirMinDeg,
		MaxDeg: fixture.Assumptions.OffNadirMaxDeg,
	})
	serialWindows.MaxParallel = 1

	serialStarted := time.Now()
	serial, err := serialWindows.Compute(context.Background(), port.AccessRequest{
		Targets: targets,
		Start:   mustParse(t, fixture.Horizon.StartUTC),
		Days:    fixture.Horizon.Days,
		StepS:   fixture.Horizon.CoarseStepS,
	})
	if err != nil {
		t.Fatalf("serial compute: %v", err)
	}
	serialElapsed := time.Since(serialStarted)

	if len(serial) != len(got) {
		t.Fatalf("serial sweep found %d windows, the concurrent one found %d", len(serial), len(got))
	}
	for i := range got {
		if serial[i] != got[i] {
			t.Fatalf("window %d differs between the serial and concurrent sweeps", i)
		}
	}

	t.Logf("%d windows reproduced in %s across %d workers, %s with MaxParallel=1; worst edge gap %s (tolerance %s)",
		len(got), elapsed.Round(time.Millisecond), runtime.NumCPU(),
		serialElapsed.Round(time.Millisecond), worstEdge, edgeTolerance)
}

// manyTargets repeats one target n times, which is the shape an amplification
// attempt takes: a short query string that costs the sweep n times as much.
func manyTargets(t domain.Target, n int) []domain.Target {
	out := make([]domain.Target, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, t)
	}
	return out
}
