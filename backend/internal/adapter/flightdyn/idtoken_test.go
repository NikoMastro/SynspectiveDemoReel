package flightdyn

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// The metadata server is not reachable from a test machine, so these point
// metadataIdentityURL at an httptest server standing in for it.
func withFakeMetadata(t *testing.T, h http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(h)
	original := metadataIdentityURL
	metadataIdentityURL = server.URL
	t.Cleanup(func() {
		metadataIdentityURL = original
		server.Close()
	})
}

func TestIDToken(t *testing.T) {
	t.Run("no audience means no token", func(t *testing.T) {
		// Local development and docker-compose: there is no metadata server,
		// and asking for one would fail. This is the path that keeps
		// `go run ./cmd/scene-service` working with no configuration.
		withFakeMetadata(t, func(w http.ResponseWriter, r *http.Request) {
			t.Error("metadata server must not be called when no audience is set")
		})

		got, err := New("http://localhost:8081", "", time.Second).idToken(context.Background())
		if err != nil {
			t.Fatalf("idToken: %v", err)
		}
		if got != "" {
			t.Errorf("token = %q, want empty", got)
		}
	})

	t.Run("audience is passed through and the token comes back", func(t *testing.T) {
		const audience = "https://flightdyn-service.example.run.app"

		withFakeMetadata(t, func(w http.ResponseWriter, r *http.Request) {
			// Without this header the real metadata server refuses, so getting
			// it wrong would work here and fail only once deployed.
			if got := r.Header.Get("Metadata-Flavor"); got != "Google" {
				t.Errorf("Metadata-Flavor = %q, want Google", got)
			}
			if got := r.URL.Query().Get("audience"); got != audience {
				t.Errorf("audience = %q, want %q", got, audience)
			}
			_, _ = w.Write([]byte("header.payload.signature"))
		})

		got, err := New("http://flightdyn", audience, time.Second).idToken(context.Background())
		if err != nil {
			t.Fatalf("idToken: %v", err)
		}
		if got != "header.payload.signature" {
			t.Errorf("token = %q", got)
		}
	})

	t.Run("a refusing metadata server is an error, not a silent empty token", func(t *testing.T) {
		// An empty token here would send the request unauthenticated and come
		// back as a confusing 403 from the other service instead.
		withFakeMetadata(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
		})

		if _, err := New("http://flightdyn", "aud", time.Second).idToken(context.Background()); err == nil {
			t.Fatal("want an error when the metadata server refuses")
		}
	})
}

func TestRequestsCarryTheBearerTokenWhenConfigured(t *testing.T) {
	withFakeMetadata(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("a.b.c"))
	})

	var authorization string
	flightdyn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"points":[]}`))
	}))
	defer flightdyn.Close()

	client := New(flightdyn.URL, "https://flightdyn.example", 5*time.Second)
	if err := client.get(context.Background(), "/api/v1/ground-track", nil, &struct{}{}); err != nil {
		t.Fatalf("get: %v", err)
	}
	if want := "Bearer a.b.c"; authorization != want {
		t.Errorf("Authorization = %q, want %q", authorization, want)
	}
}
