// Package usecase holds the application services. It imports domain and port
// and nothing else: no HTTP, no JSON, no SGP4 library. That is what makes every
// one of these testable with a hand-written fake in a few lines.
package usecase

import (
	"context"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// Catalog answers questions about scenes, satellites and targets.
type Catalog struct {
	scenes  port.SceneRepository
	sats    port.SatelliteRepository
	targets port.TargetRepository
}

// NewCatalog wires the catalog to its repositories.
func NewCatalog(scenes port.SceneRepository, sats port.SatelliteRepository, targets port.TargetRepository) *Catalog {
	return &Catalog{scenes: scenes, sats: sats, targets: targets}
}

// Scenes lists the catalog, optionally filtered.
func (c *Catalog) Scenes(ctx context.Context, filter domain.SceneFilter) ([]domain.Scene, error) {
	return c.scenes.List(ctx, filter)
}

// Scene returns one scene by id.
func (c *Catalog) Scene(ctx context.Context, id string) (domain.Scene, error) {
	return c.scenes.Get(ctx, id)
}

// Satellites lists the constellation.
func (c *Catalog) Satellites(ctx context.Context) ([]domain.Satellite, error) {
	return c.sats.All(ctx)
}

// Targets lists the standing ground targets.
func (c *Catalog) Targets(ctx context.Context) ([]domain.Target, error) {
	return c.targets.All(ctx)
}

// TargetsByIDs resolves the short ids a request names.
func (c *Catalog) TargetsByIDs(ctx context.Context, ids []string) ([]domain.Target, error) {
	return c.targets.ByIDs(ctx, ids)
}
