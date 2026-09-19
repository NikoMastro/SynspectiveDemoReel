package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/wire"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/usecase"
)

// SceneServer is the HTTP surface of scene-service: the front door the browser
// talks to. It owns the catalog and forwards anything that needs orbit
// propagation to flightdyn-service through the FlightDyn port.
type SceneServer struct {
	Catalog   *usecase.Catalog
	FlightDyn port.FlightDynamics
	Log       *slog.Logger
}

// Handler builds the router.
func (s *SceneServer) Handler(allowedOrigin string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", healthHandler("scene-service", s.Log))
	mux.HandleFunc("GET /api/v1/healthz", healthHandler("scene-service", s.Log))
	mux.HandleFunc("GET /api/v1/scenes", s.handleScenes)
	mux.HandleFunc("GET /api/v1/scenes/{id}", s.handleScene)
	mux.HandleFunc("GET /api/v1/satellites", s.handleSatellites)
	mux.HandleFunc("GET /api/v1/targets", s.handleTargets)
	mux.HandleFunc("GET /api/v1/ground-track", s.handleGroundTrack)
	mux.HandleFunc("GET /api/v1/access-windows", s.handleAccessWindows)

	return withRequestLog(s.Log, withCORS(allowedOrigin, mux))
}

// handleScenes answers GET /api/v1/scenes?mode=&polarization=&orbit=
func (s *SceneServer) handleScenes(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	filter := domain.SceneFilter{
		Mode:           query.Get("mode"),
		Polarization:   query.Get("polarization"),
		OrbitDirection: query.Get("orbit"),
	}

	scenes, err := s.Catalog.Scenes(r.Context(), filter)
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	writeJSON(w, s.Log, http.StatusOK, wire.ScenesFromDomain(scenes))
}

// handleScene answers GET /api/v1/scenes/{id}. The {id} wildcard is matched by
// the standard library's ServeMux, which is why there is no router dependency.
func (s *SceneServer) handleScene(w http.ResponseWriter, r *http.Request) {
	scene, err := s.Catalog.Scene(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, s.Log, err)
		return
	}
	writeJSON(w, s.Log, http.StatusOK, wire.SceneFromDomain(scene))
}

// handleSatellites answers GET /api/v1/satellites.
func (s *SceneServer) handleSatellites(w http.ResponseWriter, r *http.Request) {
	satellites, err := s.Catalog.Satellites(r.Context())
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	writeJSON(w, s.Log, http.StatusOK, wire.SatellitesFromDomain(satellites))
}

// handleTargets answers GET /api/v1/targets, so the frontend can build its
// target picker from the server rather than hard-coding the list.
func (s *SceneServer) handleTargets(w http.ResponseWriter, r *http.Request) {
	targets, err := s.Catalog.Targets(r.Context())
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	list := wire.TargetsFromDomain(targets)
	writeJSON(w, s.Log, http.StatusOK, wire.TargetsResponse{Count: len(list), Targets: list})
}

// handleGroundTrack forwards to flightdyn-service.
func (s *SceneServer) handleGroundTrack(w http.ResponseWriter, r *http.Request) {
	req, err := parseGroundTrackQuery(r)
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	points, err := s.FlightDyn.GroundTrack(r.Context(), req)
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	writeJSON(w, s.Log, http.StatusOK, wire.GroundTrackResponse{
		Satellite: req.Satellite,
		StartUTC:  req.Start,
		StepS:     req.StepS,
		Minutes:   req.Minutes,
		Points:    wire.GroundTrackFromDomain(points),
	})
}

// handleAccessWindows resolves the target ids here and forwards the rest.
//
// The catalog lives in this service, so resolving "aso,tokyo" into coordinates
// before the hop means flightdyn-service never needs a target list of its own,
// and a mistyped target is a 404 from the service that owns the names.
func (s *SceneServer) handleAccessWindows(w http.ResponseWriter, r *http.Request) {
	ids := queryList(r, "targets")
	if len(ids) == 0 {
		writeError(w, s.Log, badRequest("targets is required, for example targets=aso,tokyo"))
		return
	}

	days, err := queryFloat(r, "days", defaultAccessDays)
	if err != nil {
		writeError(w, s.Log, err)
		return
	}
	step, err := queryInt(r, "step", defaultStepSeconds)
	if err != nil {
		writeError(w, s.Log, err)
		return
	}
	start, err := queryTime(r, "start", time.Now().UTC().Truncate(time.Second))
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	targets, err := s.Catalog.TargetsByIDs(r.Context(), ids)
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	result, err := s.FlightDyn.AccessWindows(r.Context(), port.AccessRequest{
		Targets: targets,
		Start:   start,
		Days:    days,
		StepS:   step,
	})
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	writeJSON(w, s.Log, http.StatusOK, wire.AccessWindowsResponse{
		Horizon:     wire.AccessHorizon{StartUTC: start, Days: days, CoarseStepS: step},
		Assumptions: wire.AssumptionsFor(result.Envelope),
		Targets:     wire.TargetsFromDomain(targets),
		Windows:     wire.AccessWindowsFromDomain(result.Windows),
	})
}
