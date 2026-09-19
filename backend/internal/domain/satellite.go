package domain

import (
	"math"
	"time"
)

// OrbitFamily splits the constellation the way notebook 03 does: the near-polar
// satellites can reach high latitudes, the mid-inclination ones cannot.
type OrbitFamily string

const (
	NearPolar      OrbitFamily = "near-polar"
	MidInclination OrbitFamily = "mid-inclination"
)

// Satellite is one constellation member and the TLE it is propagated from.
type Satellite struct {
	Name           string
	NoradID        int
	TLELine1       string
	TLELine2       string
	EpochUTC       time.Time
	InclinationDeg float64
	RAANDeg        float64
	Eccentricity   float64
	PeriodMinutes  float64
	MeanAltitudeKm float64
}

// Family is near-polar above 90 degrees of inclination (a retrograde,
// sun-synchronous-style orbit), mid-inclination otherwise.
func (s Satellite) Family() OrbitFamily {
	if s.InclinationDeg > 90 {
		return NearPolar
	}
	return MidInclination
}

// GroundTrackPoint is one sample of the subsatellite point.
type GroundTrackPoint struct {
	Time       time.Time
	LatDeg     float64
	LonDeg     float64
	AltitudeKm float64
	SpeedKmS   float64
}

// OrbitSizeFromMeanMotion turns the mean motion written on line 2 of a TLE into
// the two numbers an operator reads first: how long one revolution takes, and
// how high the orbit is.
//
// This is the two-body relation n^2 a^3 = GM, so the altitude is a mean over
// the orbit, not the altitude at any particular moment. Notebook 03 derives the
// fleet table the same way, which is what makes the two comparable.
func OrbitSizeFromMeanMotion(revsPerDay float64) (periodMinutes, meanAltitudeKm float64) {
	if revsPerDay <= 0 {
		return 0, 0
	}
	periodMinutes = 1440 / revsPerDay

	radPerSecond := 2 * math.Pi * revsPerDay / 86400
	semiMajorAxisM := math.Cbrt(EarthGM / (radPerSecond * radPerSecond))
	return periodMinutes, (semiMajorAxisM - EarthRadiusM) / 1000
}
