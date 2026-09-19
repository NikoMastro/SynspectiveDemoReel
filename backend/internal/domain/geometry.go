package domain

// LookSide is which side of the ground track the radar is pointing at.
type LookSide string

const (
	LookLeft  LookSide = "Left"
	LookRight LookSide = "Right"
)

// PassDirection is whether the satellite is heading north or south.
type PassDirection string

const (
	Ascending  PassDirection = "Ascending"
	Descending PassDirection = "Descending"
)

// State is a satellite position and velocity in ECEF metres.
type State struct {
	Position Vec3
	Velocity Vec3
}

// Observation is everything the access test needs about one satellite looking
// at one target at one instant.
type Observation struct {
	OffNadirDeg   float64
	ElevationDeg  float64
	LookSide      LookSide
	PassDirection PassDirection
	Subsatellite  Geodetic
}

// Observe is the one place the access geometry is computed. It measures
// off-nadir, elevation, look side and pass direction in a single pass, sharing
// the one expensive step — the geodetic conversion of the satellite position —
// between all four.
func Observe(sat State, target Geodetic) Observation {
	sub := ECEFToGeodetic(sat.Position)
	up := UpAt(sub.LatDeg, sub.LonDeg)

	targetECEF := GeodeticToECEF(target)
	look := targetECEF.Sub(sat.Position).Unit()

	obs := Observation{
		OffNadirDeg:  angleBetweenUnitVectors(look, up.Scale(-1)),
		ElevationDeg: 90 - angleBetweenUnitVectors(look.Scale(-1), UpAt(target.LatDeg, target.LonDeg)),
		Subsatellite: sub,
	}

	if look.Dot(up.Cross(sat.Velocity.Unit())) > 0 {
		obs.LookSide = LookLeft
	} else {
		obs.LookSide = LookRight
	}
	if sat.Velocity.Dot(NorthAt(sub.LatDeg, sub.LonDeg)) > 0 {
		obs.PassDirection = Ascending
	} else {
		obs.PassDirection = Descending
	}
	return obs
}
