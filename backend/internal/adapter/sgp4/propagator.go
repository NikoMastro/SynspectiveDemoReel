// Package sgp4 adapts github.com/joshuaferrara/go-satellite to the
// port.Propagator interface. It is the only place in the backend that knows
// which SGP4 implementation is in use.
package sgp4

import (
	"fmt"
	"time"

	satlib "github.com/joshuaferrara/go-satellite"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
)

// TimeResolution is the finest time step this adapter can express.
//
// The library's only exported propagation entry point is
//
//	Propagate(sat Satellite, year, month, day, hours, minutes, seconds int)
//
// — every field is an int, so there is no way to ask for a fractional second.
// The bisection that refines access-window edges therefore stops once the
// bracket is one second wide, because halving it again returns the identical
// state. This is a real limitation of the dependency, and the access-window
// tests assert against it rather than pretending the edges are exact.
const TimeResolution = time.Second

// Propagator propagates TLEs with SGP4.
//
// It holds no state, so one value is safe to share across goroutines: the
// access-window fan-out calls it from every worker at once. The library
// re-parses the TLE on each call, which is wasteful but keeps this type free of
// a cache that would need locking.
type Propagator struct{}

// New returns a propagator using the WGS72 gravity model, which is the model
// SGP4 and the TLEs themselves are defined against.
func New() *Propagator { return &Propagator{} }

// Resolution implements port.Propagator.
func (p *Propagator) Resolution() time.Duration { return TimeResolution }

// TEMEAt returns the raw SGP4 output: position and velocity in the True
// Equator Mean Equinox frame, converted from kilometres to metres. The
// reference test compares this directly against python-sgp4.
func (p *Propagator) TEMEAt(sat domain.Satellite, t time.Time) (domain.State, error) {
	rec := satlib.TLEToSat(sat.TLELine1, sat.TLELine2, satlib.GravityWGS72)
	if rec.Error != 0 {
		return domain.State{}, fmt.Errorf("sgp4: %s could not be initialised: %s", sat.Name, rec.ErrorStr)
	}

	u := t.UTC()
	pos, vel := satlib.Propagate(rec, u.Year(), int(u.Month()), u.Day(), u.Hour(), u.Minute(), u.Second())
	if pos.X == 0 && pos.Y == 0 && pos.Z == 0 {
		return domain.State{}, fmt.Errorf("sgp4: %s returned a null position at %s", sat.Name, u.Format(time.RFC3339))
	}

	return domain.State{
		Position: domain.Vec3{X: pos.X * 1000, Y: pos.Y * 1000, Z: pos.Z * 1000},
		Velocity: domain.Vec3{X: vel.X * 1000, Y: vel.Y * 1000, Z: vel.Z * 1000},
	}, nil
}

// StateAt implements port.Propagator: TEME rotated into ECEF, which is the
// frame latitude, longitude and every look angle are defined in.
func (p *Propagator) StateAt(sat domain.Satellite, t time.Time) (domain.State, error) {
	teme, err := p.TEMEAt(sat, t)
	if err != nil {
		return domain.State{}, err
	}

	gmst := GMST(t)
	r := domain.TEMEToECEF(teme.Position, gmst)
	return domain.State{
		Position: r,
		Velocity: domain.TEMEVelocityToECEF(teme.Velocity, r, gmst),
	}, nil
}

// GMST returns Greenwich Mean Sidereal Time in radians for a UTC instant.
//
// This delegates to the library's GSTimeFromDate, which matches the IAU-1982
// series used by notebook 03 to 8e-12 rad, verified in
// TestGMSTMatchesReference. Sidereal time is the one piece of this the library
// gets right, so there is no reason to hand-roll it.
func GMST(t time.Time) float64 {
	u := t.UTC()
	return satlib.GSTimeFromDate(u.Year(), int(u.Month()), u.Day(), u.Hour(), u.Minute(), u.Second())
}
