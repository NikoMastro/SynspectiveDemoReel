package sgp4_test

import (
	"math"
	"strconv"
	"testing"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/sgp4"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/testfixture"
)

// referenceFile is fixtures/sgp4_reference.json, exported by
// notebooks/03-tle-ground-track.ipynb from python-sgp4 - the Vallado reference
// implementation.
type referenceFile struct {
	ReferenceImplementation string          `json:"reference_implementation"`
	Cases                   []referenceCase `json:"cases"`
}

type referenceCase struct {
	Satellite string     `json:"satellite"`
	Norad     int        `json:"norad"`
	TLELine1  string     `json:"tle_line1"`
	TLELine2  string     `json:"tle_line2"`
	TimeUTC   string     `json:"time_utc"`
	GMSTRad   float64    `json:"gmst_rad"`
	RTEMEm    [3]float64 `json:"r_teme_m"`
	VTEMEms   [3]float64 `json:"v_teme_m_s"`
	RECEFm    [3]float64 `json:"r_ecef_m"`
	LatDeg    float64    `json:"lat_deg"`
	LonDeg    float64    `json:"lon_deg"`
	AltM      float64    `json:"alt_m"`
}

func (c referenceCase) referencePosition() domain.Vec3 {
	return domain.Vec3{X: c.RTEMEm[0], Y: c.RTEMEm[1], Z: c.RTEMEm[2]}
}

func (c referenceCase) referenceSpeed() float64 {
	return domain.Vec3{X: c.VTEMEms[0], Y: c.VTEMEms[1], Z: c.VTEMEms[2]}.Norm()
}

// epochFractionalSecond returns the part of the TLE epoch that falls below a
// whole second. Columns 19-32 of line 1 hold the epoch as a day number plus a
// fraction of a day.
func (c referenceCase) epochFractionalSecond(t *testing.T) float64 {
	t.Helper()
	day, err := strconv.ParseFloat(c.TLELine1[20:32], 64)
	if err != nil {
		t.Fatalf("parse TLE epoch of %s: %v", c.Satellite, err)
	}
	seconds := (day - math.Floor(day)) * 86400
	return seconds - math.Floor(seconds)
}

func loadReference(t *testing.T) referenceFile {
	t.Helper()
	var f referenceFile
	testfixture.LoadJSON(t, "sgp4_reference.json", &f)
	if len(f.Cases) == 0 {
		t.Fatal("sgp4_reference.json has no cases")
	}
	return f
}

func parseTime(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return ts
}

func satelliteFrom(c referenceCase) domain.Satellite {
	return domain.Satellite{Name: c.Satellite, NoradID: c.Norad, TLELine1: c.TLELine1, TLELine2: c.TLELine2}
}

// TestSGP4AgainstPythonReference propagates all 40 fixture cases with the Go
// library and differences the TEME position against python-sgp4.
//
// ---------------------------------------------------------------------------
// WHY THE TOLERANCE IS 8 km AND NOT 8 metres
//
// github.com/joshuaferrara/go-satellite does not agree with python-sgp4. Over
// these eight TLEs the disagreement runs from 1.7 km to 7.5 km depending on
// which satellite is propagated. An 8 km tolerance is not slack left for
// floating point; it is the smallest bound the library actually satisfies, and
// writing a smaller one would only mean deleting the cases that fail it.
//
// What the deviation is NOT:
//
//   - the gravity model. GravityWGS72, GravityWGS72Old and GravityWGS84 put the
//     same TLE within 12 m of each other, three orders of magnitude below what
//     is measured here.
//   - the frame rotation. The library's GSTimeFromDate matches the notebook's
//     IAU-1982 sidereal time to 8e-12 rad, which TestGMSTMatchesReference pins
//     down separately, precisely so this test cannot be blamed on it.
//
// What it is, is the subject of the next test: the library truncates the TLE
// epoch to a whole second, so every propagation starts from an epoch up to one
// second early and lands up to one second of orbital motion - about 7.6 km -
// down-track. An earlier spot check on STRIX-3 measured 2.48 km; STRIX-3's
// epoch discards 0.326 s, which at its orbital speed is that same 2.48 km. The
// deviation is not noise and not random per call: it is a fixed per-TLE offset.
//
// Why this backend keeps using the library anyway. The workaround would be to
// call Propagate at the two whole seconds bracketing the instant wanted and
// interpolate between them - but the exported API takes integer seconds only,
// so knowing how far to shift means reproducing the library's internal epoch
// arithmetic. That is fragile code resting on an unexported detail, and this
// repository would rather carry a known, measured, signed error than an
// unmaintainable correction for it. For planning-grade work - access-window
// edges good to about a second - a fixed down-track offset of a few kilometres
// is tolerable. For anything that points a real antenna it is not, which is
// exactly why it is written down here rather than buried.
//
// t.Logf prints the worst deviation on every run, so a dependency upgrade that
// fixes or worsens this shows up in the test output instead of passing quietly.
// ---------------------------------------------------------------------------
func TestSGP4AgainstPythonReference(t *testing.T) {
	const toleranceM = 8000.0

	ref := loadReference(t)
	prop := sgp4.New()

	var worst float64
	var worstCase string

	for _, c := range ref.Cases {
		t.Run(c.Satellite+"@"+c.TimeUTC, func(t *testing.T) {
			got, err := prop.TEMEAt(satelliteFrom(c), parseTime(t, c.TimeUTC))
			if err != nil {
				t.Fatalf("propagate: %v", err)
			}

			deviation := got.Position.Sub(c.referencePosition()).Norm()
			if deviation > worst {
				worst, worstCase = deviation, c.Satellite+" at "+c.TimeUTC
			}
			if deviation > toleranceM {
				t.Errorf("TEME position off by %.1f m, tolerance %.0f m\n got  %+v\n want %+v",
					deviation, toleranceM, got.Position, c.referencePosition())
			}
		})
	}

	t.Logf("%d cases against %s", len(ref.Cases), ref.ReferenceImplementation)
	t.Logf("worst TEME deviation: %.1f m (%s), tolerance %.0f m", worst, worstCase, toleranceM)
}

// TestSGP4DeviationIsTheTruncatedTLEEpoch names the cause of the kilometres
// above instead of leaving them as something the reader has to take on trust.
//
// In the library's helpers.go, TLEToSat converts the TLE epoch to a Julian date
// with
//
//	sat.jdsatepoch = JDay(int(year), int(mon), int(day), int(hr), int(min), int(sec))
//
// where sec arrives as a float64. That int() throws away the fraction of a
// second, so the propagator believes the elements are valid slightly earlier
// than they are, and every result is shifted down-track by that much motion.
//
// The test writes the explanation down as a prediction and then checks it:
// divide the observed position error by the reference speed, and the answer
// should be the discarded fraction of a second. Over all 40 cases the two agree
// to under a millisecond, which is as close to a proof as a black-box test gets.
func TestSGP4DeviationIsTheTruncatedTLEEpoch(t *testing.T) {
	const toleranceS = 0.001

	ref := loadReference(t)
	prop := sgp4.New()

	var worst float64
	for _, c := range ref.Cases {
		got, err := prop.TEMEAt(satelliteFrom(c), parseTime(t, c.TimeUTC))
		if err != nil {
			t.Fatalf("propagate: %v", err)
		}

		// How long the satellite would need to fly to cover the error.
		impliedS := got.Position.Sub(c.referencePosition()).Norm() / c.referenceSpeed()
		predictedS := c.epochFractionalSecond(t)

		gap := math.Abs(impliedS - predictedS)
		if gap > toleranceS {
			t.Errorf("%s at %s: position error is %.4f s of motion, but the TLE epoch "+
				"discards %.4f s (difference %.4f s)", c.Satellite, c.TimeUTC, impliedS, predictedS, gap)
		}
		if gap > worst {
			worst = gap
		}
	}
	t.Logf("over %d cases the position error matches the discarded epoch fraction to %.1e s",
		len(ref.Cases), worst)
}

// TestGMSTMatchesReference checks the sidereal angle on its own, at a tolerance
// nine orders of magnitude tighter than the propagation test. Separating the
// two is the point: it proves the frame rotation is not what costs the
// kilometres.
func TestGMSTMatchesReference(t *testing.T) {
	const toleranceRad = 1e-9

	ref := loadReference(t)

	var worst float64
	for _, c := range ref.Cases {
		got := sgp4.GMST(parseTime(t, c.TimeUTC))
		diff := math.Abs(got - c.GMSTRad)
		if diff > worst {
			worst = diff
		}
		if diff > toleranceRad {
			t.Errorf("%s at %s: GMST %.15f, want %.15f (off by %.3e rad)",
				c.Satellite, c.TimeUTC, got, c.GMSTRad, diff)
		}
	}
	t.Logf("worst GMST deviation over %d cases: %.3e rad, tolerance %.0e rad",
		len(ref.Cases), worst, toleranceRad)
}

// TestStateAtProducesTheExpectedSubsatellitePoint closes the loop from TLE to
// latitude and longitude: SGP4 out in TEME, rotated into ECEF, converted on the
// WGS84 ellipsoid.
//
// The tolerances follow from the tests above rather than being picked. Up to
// 7.6 km of DOWN-TRACK offset is about 0.07 degrees of arc, which is what the
// angular tolerance allows. Altitude is the interesting one: a purely
// down-track shift barely changes the radius, so 50 m is a tight check on the
// ellipsoid conversion even while the horizontal position is kilometres out.
func TestStateAtProducesTheExpectedSubsatellitePoint(t *testing.T) {
	const (
		toleranceDeg = 0.07
		toleranceAlt = 50.0
	)

	ref := loadReference(t)
	prop := sgp4.New()

	for _, c := range ref.Cases {
		state, err := prop.StateAt(satelliteFrom(c), parseTime(t, c.TimeUTC))
		if err != nil {
			t.Fatalf("propagate: %v", err)
		}
		g := domain.ECEFToGeodetic(state.Position)

		if d := math.Abs(g.LatDeg - c.LatDeg); d > toleranceDeg {
			t.Errorf("%s at %s: latitude %.4f, want %.4f", c.Satellite, c.TimeUTC, g.LatDeg, c.LatDeg)
		}
		if d := angularGapDeg(g.LonDeg, c.LonDeg); d > toleranceDeg {
			t.Errorf("%s at %s: longitude %.4f, want %.4f", c.Satellite, c.TimeUTC, g.LonDeg, c.LonDeg)
		}
		if d := math.Abs(g.AltitudeM - c.AltM); d > toleranceAlt {
			t.Errorf("%s at %s: altitude %.0f m, want %.0f m", c.Satellite, c.TimeUTC, g.AltitudeM, c.AltM)
		}
	}
}

// angularGapDeg is the shortest way round between two longitudes, so that
// -179.9 and 179.9 are 0.2 degrees apart rather than 359.8.
func angularGapDeg(a, b float64) float64 {
	d := math.Mod(math.Abs(a-b), 360)
	if d > 180 {
		return 360 - d
	}
	return d
}
