// Package port holds the interfaces the use cases need. It depends on domain
// and on nothing else in this project, which is what keeps the dependency
// arrows pointing inward: a use case asks for a Propagator, and whether that is
// SGP4, a stub in a test, or an HTTP call to another service is not its
// business.
package port

import (
	"context"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
)

// SceneRepository is the scene catalog.
type SceneRepository interface {
	List(ctx context.Context, filter domain.SceneFilter) ([]domain.Scene, error)
	Get(ctx context.Context, id string) (domain.Scene, error)
}

// SatelliteRepository is the constellation and its TLEs.
type SatelliteRepository interface {
	All(ctx context.Context) ([]domain.Satellite, error)
	ByName(ctx context.Context, name string) (domain.Satellite, error)
}

// TargetRepository is the catalog of standing ground targets.
type TargetRepository interface {
	All(ctx context.Context) ([]domain.Target, error)
	ByIDs(ctx context.Context, ids []string) ([]domain.Target, error)
}

// Propagator turns a TLE into a state vector at a time.
type Propagator interface {
	// StateAt returns the ECEF position and velocity, in metres and metres per
	// second.
	StateAt(sat domain.Satellite, t time.Time) (domain.State, error)

	// Resolution is the finest time step the propagator can distinguish.
	// Callers that bisect need it: halving an interval below this buys nothing
	// because both ends return the same state.
	Resolution() time.Duration
}

// FlightDynamics is what scene-service needs from flightdyn-service. The
// interface lives here, on the calling side, so scene-service's use cases are
// testable without a second process running.
type FlightDynamics interface {
	GroundTrack(ctx context.Context, req GroundTrackRequest) ([]domain.GroundTrackPoint, error)
	AccessWindows(ctx context.Context, req AccessRequest) (AccessResult, error)
}

// GroundTrackRequest asks for one satellite's subsatellite track.
type GroundTrackRequest struct {
	Satellite string
	Start     time.Time
	Minutes   int
	StepS     int
}

// AccessResult carries the windows together with the steering envelope they
// were computed under. The two travel together on purpose: the envelope is an
// assumption, the windows are only meaningful beside it, and scene-service
// should report the envelope flightdyn-service actually used rather than its
// own copy of the same setting.
type AccessResult struct {
	Windows  []domain.AccessWindow
	Envelope domain.OffNadirEnvelope
}

// AccessRequest asks for the access windows of every satellite over a set of
// targets.
type AccessRequest struct {
	Targets []domain.Target
	Start   time.Time
	Days    float64
	StepS   int
}

// NotFoundError is returned by repositories when an id does not exist. One
// error type keeps the HTTP layer from having to know anything about storage.
// Message is the whole sentence rather than just the subject, so that the
// error survives a round trip through JSON and back without a second "not
// found" being tacked on.
type NotFoundError struct{ Message string }

func (e NotFoundError) Error() string { return e.Message }

// InvalidRequestError is returned by a use case when the caller asked for
// something out of range. It lives here, not in the HTTP layer, because the
// limits are a statement about the work rather than about the transport - the
// HTTP layer only has to decide that this one means 400 rather than 500.
type InvalidRequestError struct{ Reason string }

func (e InvalidRequestError) Error() string { return e.Reason }
