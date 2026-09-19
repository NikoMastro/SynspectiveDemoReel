package usecase

import (
	"context"
	"fmt"
	"runtime"
	"sort"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// Limits on one access-window request. A week over eight satellites and four
// targets at a 20 second step is already about 970,000 geometry evaluations.
const (
	maxAccessDays  = 7.0
	minAccessStepS = 1
	maxAccessStepS = 120

	// The sweep costs len(satellites) * len(targets) * horizon/step evaluations,
	// so the target count is a multiplier on everything else and belongs under a
	// limit like the rest. Four standing targets exist; a request asking for more
	// than twice that is not a planner.
	maxAccessTargets = 8
)

// AccessWindows computes, for every satellite and every requested target, the
// intervals during which the target can be imaged.
type AccessWindows struct {
	sats     port.SatelliteRepository
	prop     port.Propagator
	envelope domain.OffNadirEnvelope

	// MaxParallel caps the fan-out. 0 means runtime.NumCPU(), which is what
	// production uses; a test sets it to 1 to measure what the concurrency
	// actually buys, so the speed claim in the README has a baseline behind it.
	MaxParallel int
}

// NewAccessWindows wires the use case. The envelope is passed in rather than
// read from a package variable so that a test can hold it fixed and an operator
// can change it by environment variable.
func NewAccessWindows(sats port.SatelliteRepository, prop port.Propagator, envelope domain.OffNadirEnvelope) *AccessWindows {
	return &AccessWindows{sats: sats, prop: prop, envelope: envelope}
}

// Envelope is the steering range this sweep was built with. The handler reports
// it beside the windows, so the API states the envelope actually used rather
// than a second copy of the same setting kept somewhere else.
func (a *AccessWindows) Envelope() domain.OffNadirEnvelope { return a.envelope }

// pair is one satellite against one target: the unit of independent work.
type pair struct {
	satellite domain.Satellite
	target    domain.Target
}

// Compute fans the sweep out across satellite-target pairs.
//
// WHY THIS SHAPE
//
//   - The pairs are genuinely independent. Satellite A against target B needs
//     nothing from any other pair, so there is no shared state to protect and
//     no ordering to preserve while the work runs.
//   - The work is CPU-bound, not I/O-bound: it is SGP4 and trigonometry with no
//     network in the loop. So the useful limit is the number of cores, and
//     SetLimit(runtime.NumCPU()) says exactly that. Spawning one goroutine per
//     pair unbounded would only add scheduling.
//   - Each result goes into a slice slot chosen by the pair's index. Every
//     goroutine writes to a different element of a slice that was sized before
//     any of them started, so there is no mutex and no channel to reason about,
//     and the output order does not depend on which goroutine finished first.
//   - Cancellation comes from the HTTP request. errgroup.WithContext cancels
//     the derived context as soon as one pair fails, and the sweep checks it. A
//     browser that reloads or navigates away aborts its fetch
//     (frontend/src/components/useConsoleData.ts holds an AbortController and
//     aborts it on effect cleanup), the connection closes, and the cancellation
//     reaches this sweep through the request context instead of leaving it
//     running to completion for an answer nobody will read.
//
// This is deliberately not a worker-pool abstraction. errgroup already is the
// worker pool; a layer on top of it would be one more thing to explain.
func (a *AccessWindows) Compute(ctx context.Context, req port.AccessRequest) ([]domain.AccessWindow, error) {
	if err := validateAccessRequest(req); err != nil {
		return nil, err
	}

	satellites, err := a.sats.All(ctx)
	if err != nil {
		return nil, err
	}

	pairs := make([]pair, 0, len(satellites)*len(req.Targets))
	for _, s := range satellites {
		for _, t := range req.Targets {
			pairs = append(pairs, pair{satellite: s, target: t})
		}
	}

	// One slot per pair, allocated up front: the workers fill in disjoint
	// elements, which needs no synchronisation at all.
	perPair := make([][]domain.AccessWindow, len(pairs))

	limit := a.MaxParallel
	if limit == 0 {
		limit = runtime.NumCPU()
	}
	group, ctx := errgroup.WithContext(ctx)
	group.SetLimit(limit)
	for i, p := range pairs {
		// Go 1.22 and later give each iteration its own i and p, so the closure
		// captures this pair and not the last one.
		group.Go(func() error {
			windows, err := a.sweepPair(ctx, p, req)
			if err != nil {
				return fmt.Errorf("%s over %s: %w", p.satellite.Name, p.target.Name, err)
			}
			perPair[i] = windows
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return nil, err
	}

	return flattenByStart(perPair), nil
}

// flattenByStart merges the per-pair results into the chronological list a
// planning timeline reads top to bottom.
func flattenByStart(perPair [][]domain.AccessWindow) []domain.AccessWindow {
	total := 0
	for _, w := range perPair {
		total += len(w)
	}

	all := make([]domain.AccessWindow, 0, total)
	for _, w := range perPair {
		all = append(all, w...)
	}

	// Start, then satellite, then target: a total order on the data, so two
	// runs of the same sweep produce the same slice even when two pairs share a
	// start instant and the goroutines finished in a different order.
	sort.Slice(all, func(i, j int) bool {
		if !all[i].Start.Equal(all[j].Start) {
			return all[i].Start.Before(all[j].Start)
		}
		if all[i].Satellite != all[j].Satellite {
			return all[i].Satellite < all[j].Satellite
		}
		return all[i].TargetID < all[j].TargetID
	})
	return all
}

func validateAccessRequest(req port.AccessRequest) error {
	reject := func(format string, args ...any) error {
		return port.InvalidRequestError{Reason: fmt.Sprintf(format, args...)}
	}

	switch {
	case len(req.Targets) == 0:
		return reject("at least one target is required")
	case len(req.Targets) > maxAccessTargets:
		return reject("at most %d targets per request, got %d", maxAccessTargets, len(req.Targets))
	case req.Days <= 0 || req.Days > maxAccessDays:
		return reject("days must be between 0 and %.0f, got %.2f", maxAccessDays, req.Days)
	case req.StepS < minAccessStepS || req.StepS > maxAccessStepS:
		return reject("step must be between %d and %d seconds, got %d", minAccessStepS, maxAccessStepS, req.StepS)
	case req.Start.IsZero():
		return reject("start time is required")
	case req.Start.After(time.Now().UTC().AddDate(1, 0, 0)):
		return reject("start time is more than a year away, and a TLE is not valid that far out")
	default:
		return nil
	}
}
