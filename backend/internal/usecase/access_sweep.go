package usecase

import (
	"context"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// maxBisectionSteps bounds the edge refinement. Thirty halvings take a 20
// second bracket below a microsecond, which is what notebook 04 does — but the
// loop normally stops long before that, as soon as the bracket is narrower than
// the propagator can distinguish. See refineEdge.
const maxBisectionSteps = 30

// sweepPair walks the horizon for one satellite over one target.
//
// The coarse step finds roughly where the constraint is satisfied. It cannot
// place the edges: with a 20 second step the reported start and end are each up
// to 20 seconds out, and window edges are exactly what a schedule is built
// from. So each edge is then refined by bisection between the last sample
// outside the window and the first sample inside it.
func (a *AccessWindows) sweepPair(ctx context.Context, p pair, req port.AccessRequest) ([]domain.AccessWindow, error) {
	step := time.Duration(req.StepS) * time.Second
	steps := int(req.Days * 86400 / float64(req.StepS))

	var (
		windows      []domain.AccessWindow
		wasVisible   bool
		windowIsOpen bool
		lastOutside  time.Time
		best         domain.Observation
		bestAt       time.Time
	)

	for i := 0; i <= steps; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		now := req.Start.Add(time.Duration(i) * step)
		obs, err := a.observe(p, now)
		if err != nil {
			return nil, err
		}
		visible := a.envelope.Allows(obs)

		switch {
		case visible && !wasVisible:
			// A window that is already open at the first sample has no
			// measurable start, so it is skipped rather than reported with a
			// made-up edge. Notebook 04 drops it for the same reason.
			if i > 0 {
				windowIsOpen = true
				lastOutside = now.Add(-step)
				best, bestAt = obs, now
			}

		case visible && windowIsOpen:
			// The best geometry in a window is its smallest off-nadir angle.
			if obs.OffNadirDeg < best.OffNadirDeg {
				best, bestAt = obs, now
			}

		case !visible && windowIsOpen:
			lastInside := now.Add(-step)
			start, err := a.refineEdge(p, lastOutside, lastInside)
			if err != nil {
				return nil, err
			}
			end, err := a.refineEdge(p, now, lastInside)
			if err != nil {
				return nil, err
			}

			windows = append(windows, domain.AccessWindow{
				Satellite:       p.satellite.Name,
				TargetID:        p.target.ID,
				TargetName:      p.target.Name,
				Start:           start,
				End:             end,
				BestOffNadirDeg: best.OffNadirDeg,
				BestAt:          bestAt,
				LookSide:        best.LookSide,
				PassDirection:   best.PassDirection,
			})
			windowIsOpen = false
		}

		wasVisible = visible
	}

	// A window still open when the horizon runs out is dropped: its end is
	// unknown, and a planning tool should not invent one.
	return windows, nil
}

// refineEdge bisects between a time known to be outside the window and a time
// known to be inside it, and returns the inside end of the final bracket.
//
// The loop stops early once the bracket is narrower than the propagator's own
// time resolution. That is not an optimisation: the SGP4 adapter can only be
// asked for whole seconds, so halving below one second returns the identical
// state and the extra iterations would be theatre. The limitation, and why the
// backend lives with it, is documented in internal/adapter/sgp4.
func (a *AccessWindows) refineEdge(p pair, outside, inside time.Time) (time.Time, error) {
	resolution := a.prop.Resolution()

	for n := 0; n < maxBisectionSteps; n++ {
		gap := inside.Sub(outside)
		if gap < 0 {
			gap = -gap
		}
		if gap <= resolution {
			break
		}

		middle := outside.Add(inside.Sub(outside) / 2)
		obs, err := a.observe(p, middle)
		if err != nil {
			return time.Time{}, err
		}
		if a.envelope.Allows(obs) {
			inside = middle
		} else {
			outside = middle
		}
	}
	return inside, nil
}

// observe propagates the satellite and measures the geometry towards the
// target. It is the one place in the sweep that touches the propagator.
func (a *AccessWindows) observe(p pair, t time.Time) (domain.Observation, error) {
	state, err := a.prop.StateAt(p.satellite, t)
	if err != nil {
		return domain.Observation{}, err
	}
	return domain.Observe(state, p.target.Geodetic()), nil
}
