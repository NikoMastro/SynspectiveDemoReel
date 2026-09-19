package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/wire"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/usecase"
)

// Defaults for the flight-dynamics endpoints. A hundred minutes is a little
// over one revolution, and twenty seconds is the step notebooks 03 and 04 used,
// so the service and the analysis produce comparable output out of the box.
const (
	defaultTrackMinutes = 100
	defaultStepSeconds  = 20
	defaultAccessDays   = 3.0
)

// FlightDynServer is the HTTP surface of flightdyn-service: orbit propagation
// and access-window computation. It owns no state beyond the use cases it
// calls.
type FlightDynServer struct {
	GroundTrack *usecase.GroundTrack
	Access      *usecase.AccessWindows
	Targets     port.TargetRepository
	Log         *slog.Logger
}

// Handler builds the router. Go 1.22's ServeMux matches on method and path
// pattern by itself, so there is no router library here to explain.
func (s *FlightDynServer) Handler(allowedOrigin string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", healthHandler("flightdyn-service", s.Log))
	mux.HandleFunc("GET /api/v1/healthz", healthHandler("flightdyn-service", s.Log))
	mux.HandleFunc("GET /api/v1/ground-track", s.handleGroundTrack)
	mux.HandleFunc("GET /api/v1/access-windows", s.handleAccessWindows)

	return withRequestLog(s.Log, withCORS(allowedOrigin, mux))
}

// handleGroundTrack answers GET /api/v1/ground-track?sat=STRIX-3&minutes=100&step=20
func (s *FlightDynServer) handleGroundTrack(w http.ResponseWriter, r *http.Request) {
	req, err := parseGroundTrackQuery(r)
	if err != nil {
		writeError(w, s.Log, err)
		return
	}

	// r.Context() is cancelled when the client goes away, and the use case
	// checks it, so an abandoned request stops propagating.
	points, err := s.GroundTrack.Compute(r.Context(), req)
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

// handleAccessWindows answers GET /api/v1/access-windows?targets=aso,tokyo&days=3
func (s *FlightDynServer) handleAccessWindows(w http.ResponseWriter, r *http.Request) {
	ids := queryList(r, "targets")
	if len(ids) == 0 {
		writeError(w, s.Log, badRequest("targets is required, for example targets=aso,tokyo"))
		return
	}

	targets, err := s.Targets.ByIDs(r.Context(), ids)
	if err != nil {
		writeError(w, s.Log, err)
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

	windows, err := s.Access.Compute(r.Context(), port.AccessRequest{
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
		Assumptions: wire.AssumptionsFor(s.Access.Envelope()),
		Targets:     wire.TargetsFromDomain(targets),
		Windows:     wire.AccessWindowsFromDomain(windows),
	})
}

// parseGroundTrackQuery is shared by both services: scene-service parses the
// same query before forwarding it, so anything MALFORMED - a missing sat, a
// non-numeric step, an unparseable start - is a 400 from the edge. The range
// limits are a use-case rule, so an out-of-range minutes or days is still
// rejected one hop later, by the service that owns the limit.
func parseGroundTrackQuery(r *http.Request) (port.GroundTrackRequest, error) {
	satellite := r.URL.Query().Get("sat")
	if satellite == "" {
		return port.GroundTrackRequest{}, badRequest("sat is required, for example sat=STRIX-3")
	}

	minutes, err := queryInt(r, "minutes", defaultTrackMinutes)
	if err != nil {
		return port.GroundTrackRequest{}, err
	}
	step, err := queryInt(r, "step", defaultStepSeconds)
	if err != nil {
		return port.GroundTrackRequest{}, err
	}
	start, err := queryTime(r, "start", time.Now().UTC().Truncate(time.Second))
	if err != nil {
		return port.GroundTrackRequest{}, err
	}

	return port.GroundTrackRequest{
		Satellite: satellite,
		Start:     start,
		Minutes:   minutes,
		StepS:     step,
	}, nil
}
