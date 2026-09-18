package domain_test

import (
	"math"
	"testing"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/testfixture"
)

// frameCase carries the three frames of one reference sample: what SGP4
// produced, and what notebook 03 turned it into.
type frameCase struct {
	Satellite string     `json:"satellite"`
	TimeUTC   string     `json:"time_utc"`
	GMSTRad   float64    `json:"gmst_rad"`
	RTEMEm    [3]float64 `json:"r_teme_m"`
	VTEMEms   [3]float64 `json:"v_teme_m_s"`
	RECEFm    [3]float64 `json:"r_ecef_m"`
	VECEFms   [3]float64 `json:"v_ecef_m_s"`
	LatDeg    float64    `json:"lat_deg"`
	LonDeg    float64    `json:"lon_deg"`
	AltM      float64    `json:"alt_m"`
}

func loadFrames(t *testing.T) []frameCase {
	t.Helper()
	var f struct {
		Cases []frameCase `json:"cases"`
	}
	testfixture.LoadJSON(t, "sgp4_reference.json", &f)
	if len(f.Cases) == 0 {
		t.Fatal("sgp4_reference.json has no cases")
	}
	return f.Cases
}

func vec(a [3]float64) domain.Vec3 { return domain.Vec3{X: a[0], Y: a[1], Z: a[2]} }

// TestTEMEToECEFMatchesReference feeds the reference TEME vectors and the
// reference sidereal angle straight into the rotation, so the only thing under
// test is the frame conversion itself. No propagation is involved, which is why
// the tolerance can be a millimetre rather than kilometres.
func TestTEMEToECEFMatchesReference(t *testing.T) {
	const toleranceM = 0.001

	var worst float64
	for _, c := range loadFrames(t) {
		got := domain.TEMEToECEF(vec(c.RTEMEm), c.GMSTRad)
		if d := got.Sub(vec(c.RECEFm)).Norm(); d > toleranceM {
			t.Errorf("%s at %s: ECEF position off by %.6f m", c.Satellite, c.TimeUTC, d)
		} else if d > worst {
			worst = d
		}
	}
	t.Logf("worst ECEF position difference: %.2e m", worst)
}

// TestECEFVelocityNeedsOmegaCrossR is the one notebook 03 calls a trap.
//
// Rotating the velocity vector into ECEF is not enough. An observer standing on
// the turning Earth also sees the ground move, so the rotating-frame term
// omega x r has to be subtracted afterwards. Leave it out and the position
// still looks right while every derived quantity - orbital elements, look side,
// ascending or descending - comes out wrong.
//
// The test asserts both halves: that doing it correctly matches the reference
// to a millimetre per second, and that skipping the subtraction misses by
// hundreds of metres per second. The second assertion is what stops the first
// one from passing for the wrong reason.
func TestECEFVelocityNeedsOmegaCrossR(t *testing.T) {
	const toleranceMS = 0.001

	for _, c := range loadFrames(t) {
		rECEF := domain.TEMEToECEF(vec(c.RTEMEm), c.GMSTRad)

		got := domain.TEMEVelocityToECEF(vec(c.VTEMEms), rECEF, c.GMSTRad)
		if d := got.Sub(vec(c.VECEFms)).Norm(); d > toleranceMS {
			t.Errorf("%s at %s: ECEF velocity off by %.6f m/s", c.Satellite, c.TimeUTC, d)
		}

		// Rotation alone, the mistake this test exists to catch.
		rotatedOnly := domain.TEMEToECEF(vec(c.VTEMEms), c.GMSTRad)
		if d := rotatedOnly.Sub(vec(c.VECEFms)).Norm(); d < 100 {
			t.Errorf("%s at %s: rotating without subtracting omega x r should be badly wrong, "+
				"but it is only %.3f m/s out - the test is no longer proving anything",
				c.Satellite, c.TimeUTC, d)
		}
	}
}

// TestGeodeticRoundTrip checks that the ellipsoid conversion and its iterative
// inverse agree with each other, over a spread of latitudes including the poles
// and altitudes from sea level to well above the constellation.
func TestGeodeticRoundTrip(t *testing.T) {
	const (
		toleranceDeg = 1e-9
		toleranceM   = 1e-6
	)

	latitudes := []float64{-89.9, -78.2232, -45, -6.2088, 0, 32.887635, 35.6762, 60, 89.9}
	longitudes := []float64{-179.5, -131.09, -0.1, 0, 15.6267, 106.8456, 139.6503, 179.5}
	altitudes := []float64{0, 500, 500_000, 1_200_000}

	for _, lat := range latitudes {
		for _, lon := range longitudes {
			for _, alt := range altitudes {
				in := domain.Geodetic{LatDeg: lat, LonDeg: lon, AltitudeM: alt}
				out := domain.ECEFToGeodetic(domain.GeodeticToECEF(in))

				if d := math.Abs(out.LatDeg - lat); d > toleranceDeg {
					t.Errorf("lat %.6f alt %.0f: round trip gave %.9f", lat, alt, out.LatDeg)
				}
				if d := math.Abs(out.LonDeg - lon); d > toleranceDeg {
					t.Errorf("lon %.6f alt %.0f: round trip gave %.9f", lon, alt, out.LonDeg)
				}
				if d := math.Abs(out.AltitudeM - alt); d > toleranceM {
					t.Errorf("alt %.0f at lat %.4f: round trip gave %.9f", alt, lat, out.AltitudeM)
				}
			}
		}
	}
}

// TestSubsatellitePointMatchesReference checks the ellipsoid conversion against
// the notebook's own latitude, longitude and altitude, using the reference ECEF
// position so that nothing the propagator does can affect the result.
func TestSubsatellitePointMatchesReference(t *testing.T) {
	const (
		toleranceDeg = 1e-9
		toleranceM   = 1e-4
	)

	for _, c := range loadFrames(t) {
		got := domain.ECEFToGeodetic(vec(c.RECEFm))

		if d := math.Abs(got.LatDeg - c.LatDeg); d > toleranceDeg {
			t.Errorf("%s at %s: latitude %.12f, want %.12f", c.Satellite, c.TimeUTC, got.LatDeg, c.LatDeg)
		}
		if d := math.Abs(got.LonDeg - c.LonDeg); d > toleranceDeg {
			t.Errorf("%s at %s: longitude %.12f, want %.12f", c.Satellite, c.TimeUTC, got.LonDeg, c.LonDeg)
		}
		if d := math.Abs(got.AltitudeM - c.AltM); d > toleranceM {
			t.Errorf("%s at %s: altitude %.6f m, want %.6f m", c.Satellite, c.TimeUTC, got.AltitudeM, c.AltM)
		}
	}
}
