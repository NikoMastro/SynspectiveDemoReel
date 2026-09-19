package domain

import "time"

// DefaultOffNadirMinDeg and DefaultOffNadirMaxDeg are an ASSUMPTION, not a
// published figure.
//
// The Synspective SAR Data Product Format Manual is a file format
// specification: it says where the off-nadir angle is written in each product
// and in what units, but it does not publish the spacecraft's steering
// envelope. The one hard number is from the delivered StriX-3 sample product,
// which was acquired at 31.94 degrees — comfortably inside any plausible range.
//
// Notebook 04 makes the same assumption with the same two numbers, which is why
// the Go results can be compared with its fixture at all. Both ends are
// overridable by environment variable (OFF_NADIR_MIN_DEG / OFF_NADIR_MAX_DEG)
// so that anyone holding the real figures can substitute them without touching
// the code.
const (
	DefaultOffNadirMinDeg = 20.0
	DefaultOffNadirMaxDeg = 45.0
)

// OffNadirEnvelope is the range of off-nadir angles the radar can be steered
// through.
type OffNadirEnvelope struct {
	MinDeg float64
	MaxDeg float64
}

// DefaultEnvelope returns the assumed 20-45 degree envelope.
func DefaultEnvelope() OffNadirEnvelope {
	return OffNadirEnvelope{MinDeg: DefaultOffNadirMinDeg, MaxDeg: DefaultOffNadirMaxDeg}
}

// Allows reports whether the target is imageable at this instant.
//
// The horizon check has to come first and it is easy to leave out. The
// off-nadir angle is NOT monotonic in distance: it rises as the target moves
// away, peaks near the horizon, then falls again for targets on the far side of
// the planet. A constraint written on the angle alone therefore re-admits
// targets the Earth is physically blocking, and the schedule that comes out
// looks entirely plausible. Notebook 04 hit exactly that: a satellite inclined
// at 42 degrees appeared to reach Svalbard at 78 degrees north.
func (e OffNadirEnvelope) Allows(obs Observation) bool {
	if obs.ElevationDeg <= 0 {
		return false // the Earth is in the way, whatever the angle says
	}
	return obs.OffNadirDeg >= e.MinDeg && obs.OffNadirDeg <= e.MaxDeg
}

// Target is a point on the ground we want imaged.
type Target struct {
	ID     string
	Name   string
	LatDeg float64
	LonDeg float64
}

// Geodetic returns the target as a position on the ellipsoid. Targets are held
// at height 0, the same assumption notebook 04 records in its fixture.
func (t Target) Geodetic() Geodetic {
	return Geodetic{LatDeg: t.LatDeg, LonDeg: t.LonDeg}
}

// AccessWindow is one continuous interval during which a satellite can image a
// target inside the steering envelope.
type AccessWindow struct {
	Satellite       string
	TargetID        string
	TargetName      string
	Start           time.Time
	End             time.Time
	BestOffNadirDeg float64   // the best geometry available inside the window
	BestAt          time.Time // when that best geometry occurs
	LookSide        LookSide  // recorded, not filtered on: see below
	PassDirection   PassDirection
}

// Duration of the window.
func (w AccessWindow) Duration() time.Duration { return w.End.Sub(w.Start) }

// LookSide and PassDirection are recorded rather than used as filters on
// purpose. Whether a StriX can roll to both sides is a spacecraft question we
// do not have the answer to, so keeping them as fields means the constraint can
// be tightened later without redoing the sweep.
