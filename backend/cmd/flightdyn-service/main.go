// Command flightdyn-service owns orbit propagation and access-window
// computation. It is separate from scene-service because the work is different
// in kind: this is CPU-bound and fans out, the catalog is I/O-bound, and they
// scale differently.
//
//	go run ./cmd/flightdyn-service    # from the backend/ directory
package main

import (
	"os"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/httpapi"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/sgp4"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/infra"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/usecase"
)

func main() {
	log := infra.Logger("flightdyn-service")

	cfg, err := infra.Load()
	if err != nil {
		log.Error("configuration", "error", err)
		os.Exit(1)
	}

	satellites, err := repo.LoadTLEFile(cfg.TLEFile)
	if err != nil {
		log.Error("loading the TLE file", "error", err)
		os.Exit(1)
	}
	targets := repo.NewTargets()
	propagator := sgp4.New()

	server := &httpapi.FlightDynServer{
		GroundTrack: usecase.NewGroundTrack(satellites, propagator),
		Access:      usecase.NewAccessWindows(satellites, propagator, cfg.Envelope),
		Targets:     targets,
		Log:         log,
	}

	log.Info("ready",
		"tles", cfg.TLEFile,
		"off_nadir_min_deg", cfg.Envelope.MinDeg,
		"off_nadir_max_deg", cfg.Envelope.MaxDeg,
		"envelope_is_an_assumption", true)

	if err := infra.Serve(cfg.FlightDynPort, server.Handler(cfg.AllowedOrigin), log); err != nil {
		log.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
