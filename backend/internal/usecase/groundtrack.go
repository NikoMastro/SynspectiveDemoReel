package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// Limits on what a single ground-track request may ask for. They are here
// rather than in the HTTP layer because they are a statement about the work,
// not about the transport: one revolution is roughly 96 minutes, so a day of
// track at a 10 second step is already 8640 SGP4 calls for one satellite.
const (
	maxGroundTrackMinutes = 1440
	minGroundTrackStepS   = 1
)

// GroundTrack propagates one satellite and returns its subsatellite points.
type GroundTrack struct {
	sats port.SatelliteRepository
	prop port.Propagator
}

// NewGroundTrack wires the use case.
func NewGroundTrack(sats port.SatelliteRepository, prop port.Propagator) *GroundTrack {
	return &GroundTrack{sats: sats, prop: prop}
}

// Compute walks forward from req.Start in steps of req.StepS seconds.
//
// This is a plain loop, not a fan-out. One satellite over a few hundred steps
// is a few milliseconds of work, and the samples are wanted in order anyway, so
// concurrency here would cost more in scheduling than it could win. The
// fan-out lives in AccessWindows, where the work is actually wide.
func (g *GroundTrack) Compute(ctx context.Context, req port.GroundTrackRequest) ([]domain.GroundTrackPoint, error) {
	if req.Minutes <= 0 || req.Minutes > maxGroundTrackMinutes {
		return nil, port.InvalidRequestError{
			Reason: fmt.Sprintf("minutes must be between 1 and %d, got %d", maxGroundTrackMinutes, req.Minutes)}
	}
	if req.StepS < minGroundTrackStepS {
		return nil, port.InvalidRequestError{
			Reason: fmt.Sprintf("step must be at least %d second, got %d", minGroundTrackStepS, req.StepS)}
	}

	sat, err := g.sats.ByName(ctx, req.Satellite)
	if err != nil {
		return nil, err
	}

	start := req.Start
	if start.IsZero() {
		start = time.Now().UTC()
	}
	step := time.Duration(req.StepS) * time.Second
	steps := req.Minutes * 60 / req.StepS

	points := make([]domain.GroundTrackPoint, 0, steps+1)
	for i := 0; i <= steps; i++ {
		// Checked once per sample so that a browser closing its tab stops the
		// loop instead of running it out.
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		t := start.Add(time.Duration(i) * step)
		state, err := g.prop.StateAt(sat, t)
		if err != nil {
			return nil, err
		}

		geo := domain.ECEFToGeodetic(state.Position)
		points = append(points, domain.GroundTrackPoint{
			Time:       t,
			LatDeg:     geo.LatDeg,
			LonDeg:     geo.LonDeg,
			AltitudeKm: geo.AltitudeM / 1000,
			SpeedKmS:   state.Velocity.Norm() / 1000,
		})
	}
	return points, nil
}
