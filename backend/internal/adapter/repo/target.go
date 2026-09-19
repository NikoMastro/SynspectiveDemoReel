package repo

import (
	"context"
	"sort"
	"strings"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// standingTargets are the four targets notebook 04 swept, kept here with the
// same names and coordinates so the Go access windows can be differenced
// against fixtures/access_windows.json. They are a short fixed list rather than
// a file because they are part of the fixture's meaning: change them and the
// expected windows stop applying.
//
// Longyearbyen is not decoration. At 78 degrees north it sits above the
// inclination of five of the eight satellites, so it is the case that catches a
// visibility test which has forgotten the horizon check.
var standingTargets = []domain.Target{
	{ID: "aso", Name: "Mt. Aso, JP", LatDeg: 32.887635, LonDeg: 131.092252},
	{ID: "tokyo", Name: "Tokyo, JP", LatDeg: 35.6762, LonDeg: 139.6503},
	{ID: "jakarta", Name: "Jakarta, ID", LatDeg: -6.2088, LonDeg: 106.8456},
	{ID: "longyearbyen", Name: "Longyearbyen, NO", LatDeg: 78.2232, LonDeg: 15.6267},
}

// Targets is the standing-target catalog.
type Targets struct{}

// NewTargets returns the catalog.
func NewTargets() *Targets { return &Targets{} }

// All implements port.TargetRepository.
func (t *Targets) All(_ context.Context) ([]domain.Target, error) {
	out := make([]domain.Target, len(standingTargets))
	copy(out, standingTargets)
	return out, nil
}

// ByIDs resolves a list of short ids. An unknown id is an error rather than a
// silent omission: a planner who mistypes a target should be told, not handed a
// shorter answer than they asked for.
//
// Repeats collapse. Asking for the same target twice is meaningless, and
// resolving it twice would multiply the access sweep's fan-out by the number of
// copies - `targets=aso,aso,aso` used to cost three times as much as `aso` for
// an identical answer.
func (t *Targets) ByIDs(_ context.Context, ids []string) ([]domain.Target, error) {
	index := make(map[string]domain.Target, len(standingTargets))
	for _, tgt := range standingTargets {
		index[tgt.ID] = tgt
	}

	out := make([]domain.Target, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		key := strings.ToLower(strings.TrimSpace(id))
		tgt, ok := index[key]
		if !ok {
			return nil, port.NotFoundError{Message: "target " + id + " not found"}
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, tgt)
	}

	// A stable order keeps the response comparable between calls.
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
