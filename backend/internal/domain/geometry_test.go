package domain_test

import (
	"math"
	"testing"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
)

// TestOffNadirAndElevation is pure geometry: no TLE, no SGP4, no clock. Each
// case hands the functions a fixed satellite state and a fixed target and
// checks the four numbers the access rule is built on.
//
// The expected values come from notebook 04's geometry() function, evaluated on
// the same inputs. That makes the notebook the specification in a literal sense
// rather than a figurative one: if this table and the Go code ever disagree,
// one of them has drifted from the analysis the whole repository rests on.
//
// The satellite states are real ECEF positions out of
// fixtures/sgp4_reference.json, except the blind-spot case, which is
// constructed. None of the forty reference samples happens to pass within the
// lower steering limit of any of the four standing targets, so that case is
// placed by hand rather than left untested.
//
// The tolerance is 1e-6 degrees. Unlike the propagation tests there is nothing
// approximate here: both sides evaluate the same closed-form expressions in
// double precision, so anything above rounding noise is a real difference.
func TestOffNadirAndElevation(t *testing.T) {
	const toleranceDeg = 1e-6

	// The envelope is fixed here rather than read from configuration: these
	// expectations were computed against 20-45 degrees and stop meaning
	// anything if it changes.
	envelope := domain.OffNadirEnvelope{MinDeg: 20, MaxDeg: 45}

	cases := []struct {
		name             string
		why              string
		from             string
		state            domain.State
		target           domain.Target
		wantOffNadirDeg  float64
		wantElevationDeg float64
		wantLookSide     domain.LookSide
		wantPass         domain.PassDirection
		wantAllowed      bool
	}{
		{
			name: "in the steering band",
			why:  "a normal opportunity: the target is well above the horizon and the angle is inside the envelope",
			from: "STRIX-7 at 2026-09-18T09:41:25Z",
			state: domain.State{
				Position: domain.Vec3{X: -1712730.533900, Y: 6687787.372753, Z: -527801.610384},
				Velocity: domain.Vec3{X: -4637.698067, Y: -1611.842043, Z: -5334.955350},
			},
			target:           domain.Target{Name: "Jakarta, ID", LatDeg: -6.2088, LonDeg: 106.8456},
			wantOffNadirDeg:  31.496057,
			wantElevationDeg: 55.441651,
			wantLookSide:     domain.LookLeft,
			wantPass:         domain.Descending,
			wantAllowed:      true,
		},
		{
			name: "in the radar blind spot",
			why:  "line of sight is perfect, but the angle is below the lower steering limit",
			from: "constructed: 500 km above 1 deg north of Mt. Aso, flying north",
			state: domain.State{
				Position: domain.Vec3{X: -3756503.862032, Y: 4307336.910923, Z: 3814889.862825},
				Velocity: domain.Vec3{X: 2785.196672, Y: -3193.602581, Z: 6309.008009},
			},
			target:           domain.Target{Name: "Mt. Aso, JP", LatDeg: 32.887635, LonDeg: 131.092252},
			wantOffNadirDeg:  12.482978,
			wantElevationDeg: 76.517022,
			wantLookSide:     domain.LookLeft,
			wantPass:         domain.Ascending,
			wantAllowed:      false,
		},
		{
			name: "far side of the Earth",
			why:  "THE TRAP: off-nadir has fallen back inside the band while the planet is in the way",
			from: "STRIX-2 at 2026-09-18T07:49:39Z",
			state: domain.State{
				Position: domain.Vec3{X: 325864.533796, Y: -4806577.710938, Z: -4984420.475793},
				Velocity: domain.Vec3{X: -2156.958106, Y: 5211.761884, Z: -5162.925222},
			},
			target:           domain.Target{Name: "Longyearbyen, NO", LatDeg: 78.2232, LonDeg: 15.6267},
			wantOffNadirDeg:  20.299310,
			wantElevationDeg: -67.587992,
			wantLookSide:     domain.LookLeft,
			wantPass:         domain.Descending,
			wantAllowed:      false,
		},
		{
			name: "just under the horizon",
			why:  "a fraction of a degree the wrong side of the limb",
			from: "STRIX-2 at 2026-09-19T06:49:39Z",
			state: domain.State{
				Position: domain.Vec3{X: -2216230.222743, Y: 5447135.739707, Z: 3613794.211822},
				Velocity: domain.Vec3{X: 2981.015813, Y: -3040.911881, Z: 6397.777971},
			},
			target:           domain.Target{Name: "Tokyo, JP", LatDeg: 35.6762, LonDeg: 139.6503},
			wantOffNadirDeg:  67.410106,
			wantElevationDeg: -0.556492,
			wantLookSide:     domain.LookRight,
			wantPass:         domain.Ascending,
			wantAllowed:      false,
		},
		{
			name: "too oblique",
			why:  "above the horizon but past the upper steering limit",
			from: "STRIX-4 at 2026-09-18T01:58:36Z",
			state: domain.State{
				Position: domain.Vec3{X: -2986059.069125, Y: 5438492.703935, Z: 2893451.255560},
				Velocity: domain.Vec3{X: -4076.305400, Y: -4421.670227, Z: 4081.003062},
			},
			target:           domain.Target{Name: "Tokyo, JP", LatDeg: 35.6762, LonDeg: 139.6503},
			wantOffNadirDeg:  68.600994,
			wantElevationDeg: 0.601775,
			wantLookSide:     domain.LookRight,
			wantPass:         domain.Ascending,
			wantAllowed:      false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Logf("%s - %s", c.from, c.why)

			obs := domain.Observe(c.state, c.target.Geodetic())

			if d := math.Abs(obs.OffNadirDeg - c.wantOffNadirDeg); d > toleranceDeg {
				t.Errorf("off-nadir %.9f deg, want %.9f deg", obs.OffNadirDeg, c.wantOffNadirDeg)
			}
			if d := math.Abs(obs.ElevationDeg - c.wantElevationDeg); d > toleranceDeg {
				t.Errorf("elevation %.9f deg, want %.9f deg", obs.ElevationDeg, c.wantElevationDeg)
			}
			if obs.LookSide != c.wantLookSide {
				t.Errorf("look side %s, want %s", obs.LookSide, c.wantLookSide)
			}
			if obs.PassDirection != c.wantPass {
				t.Errorf("pass direction %s, want %s", obs.PassDirection, c.wantPass)
			}
			if got := envelope.Allows(obs); got != c.wantAllowed {
				t.Errorf("Allows = %v, want %v (off-nadir %.3f deg, elevation %.3f deg)",
					got, c.wantAllowed, obs.OffNadirDeg, obs.ElevationDeg)
			}
		})
	}
}

// TestHorizonCheckIsWhatRejectsTheFarSide isolates the single most important
// line in the access rule.
//
// The off-nadir angle is not monotonic in distance. It grows as the target
// moves away, peaks near the horizon, and then FALLS AGAIN for targets on the
// far side of the planet. So a visibility test written on the angle alone
// re-admits targets the Earth is physically blocking, and - this is the
// dangerous part - the schedule it produces looks entirely reasonable. In
// notebook 04 it showed up as a satellite inclined at 42 degrees appearing to
// reach Svalbard at 78 degrees north.
//
// The case below is that failure mode caught in the act: an off-nadir angle of
// 20.3 degrees, comfortably inside the 20-45 envelope, with the target 67
// degrees BELOW the horizon.
func TestHorizonCheckIsWhatRejectsTheFarSide(t *testing.T) {
	envelope := domain.OffNadirEnvelope{MinDeg: 20, MaxDeg: 45}

	// STRIX-2 at 2026-09-18T07:49:39Z, looking at Longyearbyen through the Earth.
	state := domain.State{
		Position: domain.Vec3{X: 325864.533796, Y: -4806577.710938, Z: -4984420.475793},
		Velocity: domain.Vec3{X: -2156.958106, Y: 5211.761884, Z: -5162.925222},
	}
	target := domain.Target{Name: "Longyearbyen, NO", LatDeg: 78.2232, LonDeg: 15.6267}

	obs := domain.Observe(state, target.Geodetic())

	if obs.OffNadirDeg < envelope.MinDeg || obs.OffNadirDeg > envelope.MaxDeg {
		t.Fatalf("this case is only interesting if the angle passes: got %.3f deg", obs.OffNadirDeg)
	}
	if obs.ElevationDeg >= 0 {
		t.Fatalf("this case is only interesting if the target is below the horizon: got %.3f deg", obs.ElevationDeg)
	}
	if envelope.Allows(obs) {
		t.Errorf("the Earth is in the way (elevation %.3f deg) but the target was accepted at %.3f deg off-nadir",
			obs.ElevationDeg, obs.OffNadirDeg)
	}
}
