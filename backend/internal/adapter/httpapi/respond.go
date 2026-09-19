// Package httpapi is the HTTP delivery layer: routing, query parsing, JSON
// encoding and error mapping. It is the only package that knows the services
// speak HTTP at all. Nothing below it imports net/http.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/wire"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// errorBody is the one error shape every endpoint returns, so the frontend has
// a single thing to parse.
type errorBody struct {
	Error string `json:"error"`
}

// writeJSON encodes v as the response body.
func writeJSON(w http.ResponseWriter, log *slog.Logger, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(v); err != nil {
		// The status line is already sent, so there is nothing to tell the
		// client. Log it and move on.
		log.Error("encoding the response failed", "error", err)
	}
}

// writeError maps an error to a status code in one place.
//
// The mapping is deliberately short. A missing record is a 404, a bad request
// from the caller is a 400, and everything else is a 500 whose detail stays in
// the log rather than going out over the wire.
func writeError(w http.ResponseWriter, log *slog.Logger, err error) {
	var (
		notFound port.NotFoundError
		invalid  port.InvalidRequestError
	)
	switch {
	case errors.As(err, &notFound):
		writeJSON(w, log, http.StatusNotFound, errorBody{Error: err.Error()})
	case errors.As(err, &invalid):
		writeJSON(w, log, http.StatusBadRequest, errorBody{Error: err.Error()})
	case errors.Is(err, errBadRequest):
		writeJSON(w, log, http.StatusBadRequest, errorBody{Error: err.Error()})
	case errors.Is(err, context.Canceled):
		// The caller hung up. Nothing failed, there is nobody to answer, and
		// writing a body here would only be discarded. Logged at info so a
		// browser reload does not read as a server fault in the dashboard.
		log.Info("request cancelled by the caller", "error", err)
	default:
		log.Error("request failed", "error", err)
		writeJSON(w, log, http.StatusInternalServerError, errorBody{Error: "internal error"})
	}
}

// errBadRequest marks the errors that are the caller's fault. Wrapping with %w
// keeps the explanation while making the status code obvious.
var errBadRequest = errors.New("bad request")

func badRequest(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), errBadRequest)
}

// queryInt reads an integer query parameter, falling back to a default when it
// is absent.
func queryInt(r *http.Request, name string, fallback int) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, badRequest("%s must be a whole number, got %q", name, raw)
	}
	return v, nil
}

// queryFloat reads a floating point query parameter.
func queryFloat(r *http.Request, name string, fallback float64) (float64, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, badRequest("%s must be a number, got %q", name, raw)
	}
	return v, nil
}

// queryTime reads an RFC 3339 timestamp, falling back to a default.
func queryTime(r *http.Request, name string, fallback time.Time) (time.Time, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, badRequest("%s must be an RFC 3339 time such as 2026-09-19T00:00:00Z, got %q", name, raw)
	}
	return t.UTC(), nil
}

// queryList splits a comma-separated query parameter and drops empty entries,
// so "aso,,tokyo," is the same as "aso,tokyo".
func queryList(r *http.Request, name string) []string {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return nil
	}

	var out []string
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// withCORS allows the Vite dev server on another port to call these services.
//
// This is a development convenience and it is wide open on purpose: there is no
// authentication here and nothing private to protect. A deployment behind a
// real origin would replace the wildcard with that origin, which is why the
// allowed origin comes from configuration rather than being hard-coded.
func withCORS(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withRequestLog writes one line per request. Enough to see what the frontend
// is asking for and how long it took; not an observability stack.
func withRequestLog(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"query", r.URL.RawQuery,
			"duration_ms", time.Since(started).Milliseconds())
	})
}

// Version is reported by /healthz. One constant for both services: they are
// built and deployed together, so two version numbers would only ever
// disagree by accident.
const Version = "0.1.0"

// healthHandler answers the liveness probe.
func healthHandler(service string, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, log, http.StatusOK, wire.Health{
			Status:  "ok",
			Service: service,
			Version: Version,
		})
	}
}
