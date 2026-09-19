package infra

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

// shutdownGrace is how long an in-flight request has to finish once the process
// is asked to stop. An access sweep is seconds, so ten is comfortable.
const shutdownGrace = 10 * time.Second

// Serve runs an HTTP server until Ctrl-C or SIGTERM, then drains it.
//
// Both services are identical here, so the loop lives in one place. Without the
// graceful shutdown a Cloud Run revision being replaced would cut off whatever
// was in flight; with it, the listener closes first and open requests are given
// until shutdownGrace to finish.
func Serve(addr string, handler http.Handler, log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// The server runs in its own goroutine so this one can wait on the signal.
	errs := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
			return
		}
		errs <- nil
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		log.Info("shutting down", "grace", shutdownGrace)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}
