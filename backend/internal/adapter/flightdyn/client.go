// Package flightdyn is scene-service's client for flightdyn-service. It is the
// only place that knows the two services talk over HTTP and JSON; the use cases
// above it see the port.FlightDynamics interface and nothing else.
package flightdyn

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/wire"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// metadataIdentityURL is where Cloud Run hands a service its own identity
// token. It only resolves inside Cloud Run.
//
// A var rather than a const so the tests can point it at an httptest server.
// Nothing outside the tests reassigns it.
var metadataIdentityURL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"

// Client calls flightdyn-service.
type Client struct {
	baseURL  string
	audience string
	http     *http.Client
}

// New returns a client for the service at baseURL.
//
// The timeout is a whole-request budget, not a connect timeout: a three-day
// access sweep takes seconds, and a request that has not finished in a minute
// is not going to. Sharing one http.Client is deliberate — it pools
// connections, and a new one per call would not.
// audience switches on service-to-service authentication. Set it to
// flightdyn-service's URL in Cloud Run; leave it empty everywhere else, which
// is what makes `go run` and docker-compose work unchanged.
func New(baseURL, audience string, timeout time.Duration) *Client {
	return &Client{
		baseURL:  strings.TrimRight(baseURL, "/"),
		audience: audience,
		http:     &http.Client{Timeout: timeout},
	}
}

// idToken asks Cloud Run for a token proving who this service is.
//
// Cloud Run gives every service an identity. flightdyn-service's IAM policy
// grants the invoker role to this one account and to nobody else, so it stays
// off the public internet without needing a VPC or a private network.
//
// Empty audience means we are not on Cloud Run - local development, tests,
// docker-compose - so there is no token and the request goes out plain.
//
// Fetched per request rather than cached. The metadata server is a local hop
// costing a millisecond or two, and a cache would mean holding an expiry time
// and a mutex to save it. If that ever showed up in a profile it would be worth
// adding; today it would be complexity bought with nothing.
func (c *Client) idToken(ctx context.Context) (string, error) {
	if c.audience == "" {
		return "", nil
	}

	endpoint := metadataIdentityURL + "?audience=" + url.QueryEscape(c.audience)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", fmt.Errorf("build metadata request: %w", err)
	}
	// Required by the metadata server; its absence is how it rejects requests
	// that reached it by accident, such as through a confused proxy.
	req.Header.Set("Metadata-Flavor", "Google")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("reach metadata server for an identity token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata server returned %s asking for an identity token", resp.Status)
	}
	token, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read identity token: %w", err)
	}
	return string(token), nil
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

	token, err := c.idToken(ctx)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
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
