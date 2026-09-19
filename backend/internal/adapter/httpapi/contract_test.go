package httpapi_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// The frontend declares the backend's JSON field by field in
// frontend/src/interfaces/wire.ts, and maps it in one place in
// frontend/src/lib/mapping.ts. Nothing in TypeScript can check that declaration
// against the Go structs — the two are only ever compared at runtime, in a
// browser, where a rename shows up as `undefined` in a render rather than as a
// failure anyone can trace.
//
// So the contract is pinned here instead. These tests decode the real responses
// into a plain map and assert the key names the frontend reads. Rename a Go
// struct tag and this fails immediately, in Go, naming the field — which is the
// closest thing to `buf breaking` available without introducing protobuf.
//
// Only the keys the frontend actually consumes are listed. Extra keys in the
// response are fine and deliberately not asserted against, because adding a
// field should never break a client.

func decodeObject(t *testing.T, raw []byte) map[string]any {
	t.Helper()

	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("response is not a JSON object: %v\nbody: %s", err, raw)
	}
	return m
}

func requireKeys(t *testing.T, what string, object map[string]any, keys ...string) {
	t.Helper()

	for _, key := range keys {
		if _, ok := object[key]; !ok {
			t.Errorf("%s is missing %q, which frontend/src/interfaces/wire.ts declares", what, key)
		}
	}
}

// requireKinds pins the JSON *types* of the fields where getting the type wrong
// would be as damaging as getting the name wrong, and just as invisible.
//
// requireKeys catches a rename. It does not catch a Go change that turns a
// float64 into a string: the key is still there, wire.ts still declares
// `number`, and the frontend gets "31.94" where it expected 31.94 - which
// formats fine, sorts wrongly, and breaks arithmetic silently. Only the
// numeric and nullable fields are listed, because those are the ones where a
// type change is both plausible and quiet.
func requireKinds(t *testing.T, what string, object map[string]any, kinds map[string]string) {
	t.Helper()

	for key, want := range kinds {
		value, ok := object[key]
		if !ok {
			t.Errorf("%s is missing %q", what, key)
			continue
		}

		var got string
		switch value.(type) {
		case nil:
			got = "null"
		case string:
			got = "string"
		case float64:
			got = "number"
		case bool:
			got = "bool"
		case []any:
			got = "array"
		case map[string]any:
			got = "object"
		default:
			got = "unknown"
		}

		// "number|null" is how a *float64 arrives: a real value or an absent
		// one, never a zero standing in for "not stated".
		allowed := strings.Split(want, "|")
		if !slices.Contains(allowed, got) {
			t.Errorf("%s.%s is %s, but frontend/src/interfaces/wire.ts declares %s",
				what, key, got, want)
		}
	}
}

func firstObject(t *testing.T, what string, list any) map[string]any {
	t.Helper()

	items, ok := list.([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("%s is empty, so the contract cannot be checked", what)
	}
	object, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("%s does not contain objects", what)
	}
	return object
}

func TestWireContractHealth(t *testing.T) {
	rec := get(newSceneServer(t, &stubFlightDyn{}), "/healthz")
	requireStatus(t, rec, http.StatusOK)

	requireKeys(t, "WireHealth", decodeObject(t, rec.Body.Bytes()), "status", "service", "version")
}

func TestWireContractScenes(t *testing.T) {
	rec := get(newSceneServer(t, &stubFlightDyn{}), "/api/v1/scenes")
	requireStatus(t, rec, http.StatusOK)

	body := decodeObject(t, rec.Body.Bytes())
	requireKeys(t, "WireScenesResponse", body, "scenes")

	requireKeys(t, "WireScene", firstObject(t, "scenes", body["scenes"]),
		"id",
		"satellite",
		"synthetic",
		"acquired_utc",
		"product_level",
		"imaging_mode",
		"radar_band",
		"radar_center_frequency_ghz",
		"polarization",
		"look_side",
		"pass_direction",
		"platform_heading_deg",
		"incidence_angle_deg",
		"incidence_near_deg",
		"incidence_far_deg",
		"off_nadir_deg",
		"nesz_db",
		"orbit_source",
		"center_lat_deg",
		"center_lon_deg",
		"footprint",
		"quicklook",
	)
}

// TestWireContractQuicklook pins the block the map reads to place the image.
// It is an object for the delivered scene and null for the synthetic ones, and
// both halves matter: the console draws imagery for exactly the scenes that
// have some, and a key that went missing would read as "none anywhere".
func TestWireContractQuicklook(t *testing.T) {
	handler := newSceneServer(t, &stubFlightDyn{})

	rec := get(handler, "/api/v1/scenes/STRIX3-20260615T063527Z-SL1")
	requireStatus(t, rec, http.StatusOK)
	scene := decodeObject(t, rec.Body.Bytes())
	requireKinds(t, "WireScene", scene, map[string]string{"quicklook": "object"})

	quicklook, _ := scene["quicklook"].(map[string]any)
	requireKeys(t, "WireQuicklook", quicklook, "bounds", "min_db", "max_db", "width_px", "height_px")
	requireKinds(t, "WireQuicklook", quicklook, map[string]string{
		"bounds":    "array",
		"min_db":    "number",
		"max_db":    "number",
		"width_px":  "number",
		"height_px": "number",
	})
	if bounds, _ := quicklook["bounds"].([]any); len(bounds) != 4 {
		t.Errorf("bounds has %d numbers, want 4: west, south, east, north", len(bounds))
	}

	rec = get(handler, "/api/v1/scenes/SYN-S1-20260702-01")
	requireStatus(t, rec, http.StatusOK)
	requireKinds(t, "WireScene (synthetic)", decodeObject(t, rec.Body.Bytes()),
		map[string]string{"quicklook": "null"})
}

func TestWireContractSatellites(t *testing.T) {
	rec := get(newSceneServer(t, &stubFlightDyn{}), "/api/v1/satellites")
	requireStatus(t, rec, http.StatusOK)

	body := decodeObject(t, rec.Body.Bytes())
	requireKeys(t, "WireSatellitesResponse", body, "satellites")

	satellite := firstObject(t, "satellites", body["satellites"])
	requireKeys(t, "WireSatellite", satellite,
		"name", "norad_id", "inclination_deg", "orbit_family", "tle_epoch_utc")
	requireKinds(t, "WireSatellite", satellite, map[string]string{
		"norad_id":         "number",
		"inclination_deg":  "number",
		"raan_deg":         "number",
		"eccentricity":     "number",
		"period_minutes":   "number",
		"mean_altitude_km": "number",
		"tle_epoch_utc":    "string",
		"orbit_family":     "string",
	})
}

func TestWireContractGroundTrack(t *testing.T) {
	rec := get(newFlightDynServer(t), "/api/v1/ground-track?sat=STRIX-3&minutes=10&step=60&start=2026-09-19T00:00:00Z")
	requireStatus(t, rec, http.StatusOK)

	body := decodeObject(t, rec.Body.Bytes())
	requireKeys(t, "WireGroundTrack", body, "satellite", "start_utc", "step_s", "points")

	point := firstObject(t, "points", body["points"])
	requireKeys(t, "WireTrackPoint", point, "time_utc", "lat_deg", "lon_deg", "alt_km")
	requireKinds(t, "WireTrackPoint", point, map[string]string{
		"time_utc":   "string",
		"lat_deg":    "number",
		"lon_deg":    "number",
		"alt_km":     "number",
		"speed_km_s": "number",
	})
}

// TestWireContractAccessWindows also pins the fact that the access response has
// the same shape as fixtures/access_windows.json. That is not a coincidence to
// be preserved by luck: the notebook wrote that shape, the frontend was built
// against it, and keeping them identical means the console can be pointed at
// either the fixture or the live service.
func TestWireContractAccessWindows(t *testing.T) {
	rec := get(newFlightDynServer(t),
		"/api/v1/access-windows?targets=aso,tokyo&days=0.25&step=20&start=2026-09-19T00:00:00Z")
	requireStatus(t, rec, http.StatusOK)

	body := decodeObject(t, rec.Body.Bytes())
	requireKeys(t, "WireAccessResponse", body, "horizon", "assumptions", "targets", "windows")

	horizon, ok := body["horizon"].(map[string]any)
	if !ok {
		t.Fatal("horizon is not an object")
	}
	requireKeys(t, "WireAccessHorizon", horizon, "start_utc", "days", "coarse_step_s")

	assumptions, ok := body["assumptions"].(map[string]any)
	if !ok {
		t.Fatal("assumptions is not an object")
	}
	requireKeys(t, "WireAccessAssumptions", assumptions,
		"off_nadir_min_deg", "off_nadir_max_deg", "earth_model", "frame", "note")

	requireKeys(t, "WireTarget", firstObject(t, "targets", body["targets"]),
		"id", "name", "lat_deg", "lon_deg")

	window := firstObject(t, "windows", body["windows"])
	requireKeys(t, "WireAccessWindow", window,
		"satellite", "target", "start_utc", "end_utc",
		"duration_s", "best_off_nadir_deg", "look_side", "pass_direction")
	requireKinds(t, "WireAccessWindow", window, map[string]string{
		"target_id":          "string",
		"start_utc":          "string",
		"end_utc":            "string",
		"best_at_utc":        "string",
		"duration_s":         "number",
		"best_off_nadir_deg": "number",
	})
}

// TestNESZStaysNullForTheRealScene guards one specific honesty. The delivered
// StriX-3 metadata does not state a noise floor, and the console renders null
// as "--". A Go change that made the field a plain float64 would send 0, which
// reads as a measurement of an extremely quiet radar rather than as a gap.
func TestNESZStaysNullForTheRealScene(t *testing.T) {
	rec := get(newSceneServer(t, &stubFlightDyn{}), "/api/v1/scenes/STRIX3-20260615T063527Z-SL1")
	requireStatus(t, rec, http.StatusOK)

	scene := decodeObject(t, rec.Body.Bytes())

	value, present := scene["nesz_db"]
	if !present {
		t.Fatal("nesz_db must be present and null, not omitted")
	}
	if value != nil {
		t.Errorf("nesz_db is %v, want null: the delivered metadata does not state it", value)
	}
}
