// Package infra is the outermost layer: configuration, logging, and the wiring
// that connects adapters to use cases. It is the only package allowed to import
// everything else, and the only one the two main packages talk to.
package infra

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
)

// Config is everything the two services read from the environment.
//
// Environment variables rather than a config file, because that is what Cloud
// Run gives you and because a service with no config file has one less thing to
// ship. Every setting has a default that works from the backend/ directory with
// no environment at all, so `go run ./cmd/scene-service` just starts.
type Config struct {
	ScenePort     string // scene-service listen address
	FlightDynPort string // flightdyn-service listen address

	SceneFile string // seed catalog
	TLEFile   string // cached Celestrak TLEs

	FlightDynURL     string        // where scene-service finds flightdyn-service
	FlightDynTimeout time.Duration // whole-request budget for that call

	// FlightDynAudience turns on service-to-service authentication. Terraform
	// sets it to flightdyn-service's own URL in Cloud Run. Empty everywhere
	// else, which is why nothing has to change to run this locally.
	FlightDynAudience string

	// Envelope is the assumed off-nadir steering range. See
	// domain.DefaultOffNadirMinDeg for why it is an assumption and not a fact.
	Envelope domain.OffNadirEnvelope

	// AllowedOrigin is the CORS origin. "*" for local development; a real
	// origin in a deployment.
	AllowedOrigin string
}

// Load reads the environment and applies defaults.
func Load() (Config, error) {
	cfg := Config{
		ScenePort:         env("SCENE_PORT", ":8080"),
		FlightDynPort:     env("FLIGHTDYN_PORT", ":8081"),
		SceneFile:         env("SCENE_FILE", "testdata/scenes.json"),
		TLEFile:           env("TLE_FILE", "../fixtures/tle_strix.txt"),
		FlightDynURL:      env("FLIGHTDYN_URL", "http://localhost:8081"),
		FlightDynAudience: env("FLIGHTDYN_AUDIENCE", ""),
		FlightDynTimeout:  time.Minute,
		AllowedOrigin:     env("ALLOWED_ORIGIN", "*"),
	}

	minDeg, err := envFloat("OFF_NADIR_MIN_DEG", domain.DefaultOffNadirMinDeg)
	if err != nil {
		return Config{}, err
	}
	maxDeg, err := envFloat("OFF_NADIR_MAX_DEG", domain.DefaultOffNadirMaxDeg)
	if err != nil {
		return Config{}, err
	}
	if minDeg < 0 || maxDeg <= minDeg || maxDeg > 90 {
		return Config{}, fmt.Errorf("off-nadir envelope %.2f-%.2f degrees is not a usable range", minDeg, maxDeg)
	}
	cfg.Envelope = domain.OffNadirEnvelope{MinDeg: minDeg, MaxDeg: maxDeg}

	return cfg, nil
}

// Logger returns the structured logger both services use. Text rather than JSON
// because these run in a terminal during development; a deployment would flip
// the handler and nothing else.
func Logger(service string) *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})).
		With("service", service)
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func envFloat(name string, fallback float64) (float64, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a number, got %q", name, raw)
	}
	return v, nil
}
