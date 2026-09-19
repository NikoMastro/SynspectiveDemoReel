// Command scene-service is the front door the browser talks to. It owns the
// scene catalog, the constellation and the standing targets, and it forwards
// anything that needs orbit propagation to flightdyn-service.
//
//	go run ./cmd/scene-service        # from the backend/ directory
package main

import (
	"os"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/flightdyn"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/httpapi"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/infra"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/usecase"
)

func main() {
	log := infra.Logger("scene-service")

	cfg, err := infra.Load()
	if err != nil {
		log.Error("configuration", "error", err)
		os.Exit(1)
	}

	// Adapters first. Both files are read now rather than lazily, so a missing
	// or malformed file stops the process here instead of surfacing as a 500 on
	// the first request.
	scenes, err := repo.LoadSceneFile(cfg.SceneFile)
	if err != nil {
		log.Error("loading the scene catalog", "error", err)
		os.Exit(1)
	}
	satellites, err := repo.LoadTLEFile(cfg.TLEFile)
	if err != nil {
		log.Error("loading the TLE file", "error", err)
		os.Exit(1)
	}
	targets := repo.NewTargets()

	// Then the use case, which sees only the ports the adapters satisfy.
	catalog := usecase.NewCatalog(scenes, satellites, targets)

	server := &httpapi.SceneServer{
		Catalog:   catalog,
		FlightDyn: flightdyn.New(cfg.FlightDynURL, cfg.FlightDynAudience, cfg.FlightDynTimeout),
		Log:       log,
	}

	log.Info("ready",
		"scenes", cfg.SceneFile,
		"tles", cfg.TLEFile,
		"flightdyn", cfg.FlightDynURL,
		"started", time.Now().UTC().Format(time.RFC3339))

	if err := infra.Serve(cfg.ScenePort, server.Handler(cfg.AllowedOrigin), log); err != nil {
		log.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
