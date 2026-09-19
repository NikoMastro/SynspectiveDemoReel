// Package flightdyn is scene-service's client for flightdyn-service. It is the
// only place that knows the two services talk over HTTP and JSON; the use cases
// above it see the port.FlightDynamics interface and nothing else.
package flightdyn

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/wire"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// Client calls flightdyn-service.
type Client struct {
	baseURL string
	http    *http.Client
}

// New returns a client for the service at baseURL.
//
// The timeout is a whole-request budget, not a connect timeout: a three-day
// access sweep takes seconds, and a request that has not finished in a minute
// is not going to. Sharing one http.Client is deliberate — it pools
// connections, and a new one per call would not.
func New(baseURL string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: timeout},
	}
}

// GroundTrack implements port.FlightDynamics.
func (c *Client) GroundTrack(ctx context.Context, req port.GroundTrackRequest) ([]domain.GroundTrackPoint, error) {
	query := url.Values{}
	query.Set("sat", req.Satellite)
	query.Set("minutes", strconv.Itoa(req.Minutes))
	query.Set("step", strconv.Itoa(req.StepS))
	query.Set("start", req.Start.UTC().Format(time.RFC3339))

	var body wire.GroundTrackResponse
	if err := c.get(ctx, "/api/v1/ground-track", query, &body); err != nil {
		return nil, err
	}
	return wire.GroundTrackToDomain(body.Points), nil
}

// AccessWindows implements port.FlightDynamics.
//
// Only the target ids cross the wire. Both services read the same standing
// target list, so sending coordinates would be sending the same table twice and
// giving it two chances to disagree with itself.
func (c *Client) AccessWindows(ctx context.Context, req port.AccessRequest) (port.AccessResult, error) {
	ids := make([]string, 0, len(req.Targets))
	for _, t := range req.Targets {
		ids = append(ids, t.ID)
	}

	query := url.Values{}
	query.Set("targets", strings.Join(ids, ","))
	query.Set("days", strconv.FormatFloat(req.Days, 'f', -1, 64))
	query.Set("step", strconv.Itoa(req.StepS))
	query.Set("start", req.Start.UTC().Format(time.RFC3339))

	var body wire.AccessWindowsResponse
	if err := c.get(ctx, "/api/v1/access-windows", query, &body); err != nil {
		return port.AccessResult{}, err
	}

	return port.AccessResult{
		Windows: wire.AccessWindowsToDomain(body.Windows),
		Envelope: domain.OffNadirEnvelope{
			MinDeg: body.Assumptions.OffNadirMinDeg,
			MaxDeg: body.Assumptions.OffNadirMaxDeg,
		},
	}, nil
}

// get performs one request and decodes the JSON body into out.
func (c *Client) get(ctx context.Context, path string, query url.Values, out any) error {
	endpoint := c.baseURL + path + "?" + query.Encode()

	// The caller's context goes on the request, so cancelling upstream closes
	// this connection rather than leaving flightdyn-service computing an answer
	// nobody is waiting for.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("build request to flightdyn-service: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("call flightdyn-service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return c.errorFromResponse(resp)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode flightdyn-service response: %w", err)
	}
	return nil
}

// errorFromResponse turns the other service's failure into one of this
// project's error types, so a 404 from flightdyn-service comes back to the
// browser as a 404 rather than as a 500.
func (c *Client) errorFromResponse(resp *http.Response) error {
	var body struct {
		Error string `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if body.Error == "" {
		body.Error = resp.Status
	}

	switch resp.StatusCode {
	case http.StatusNotFound:
		return port.NotFoundError{Message: body.Error}
	case http.StatusBadRequest:
		return port.InvalidRequestError{Reason: body.Error}
	default:
		return fmt.Errorf("flightdyn-service returned %s: %s", resp.Status, body.Error)
	}
}
