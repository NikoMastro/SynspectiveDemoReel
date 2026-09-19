// Package wire holds the JSON shapes the services exchange, and the conversions
// between them and the domain types.
//
// It exists because two different adapters need the same shapes: the HTTP
// handlers that write them, and scene-service's client that reads them back out
// of flightdyn-service. In a protobuf setup this package is what `buf generate`
// would produce; writing it by hand for six messages is less machinery than
// wiring up code generation, and it keeps the field names visible.
//
// Keeping these separate from the domain types is the point of the layering.
// The domain says PassDirection and CentreFrequencyGHz; the wire says
// "pass_direction" and "radar_center_frequency_ghz" because that is what the
// frontend's interfaces/wire.ts declares, and formats times as RFC 3339
// strings. Neither side has to change when the other does — this file is the
// one place a rename has to be made.
//
// The access-window response deliberately mirrors fixtures/access_windows.json
// field for field. The notebook wrote that shape, the frontend was built
// against it, and matching it means the console can be pointed at the fixture
// or at the live service and cannot tell the difference.
package wire

import (
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
)

// Coordinate is [longitude, latitude], the order GeoJSON and Deck.gl use.
type Coordinate [2]float64

// Health is the probe response.
type Health struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Version string `json:"version"`
}

// Scene is one acquisition in the catalog. The field names follow the
// vocabulary of the SAR Data Product Format Manual, which is also what the
// frontend's product sheet labels them with.
type Scene struct {
	ID        string `json:"id"`
	Satellite string `json:"satellite"`

	// Synthetic marks a scene whose values are illustrative rather than
	// measured. The console shows it as a badge on every such scene.
	Synthetic bool `json:"synthetic"`

	AcquiredUTC             time.Time `json:"acquired_utc"`
	ProductLevel            string    `json:"product_level"`
	ImagingMode             string    `json:"imaging_mode"`
	RadarBand               string    `json:"radar_band"`
	RadarCenterFrequencyGHz float64   `json:"radar_center_frequency_ghz"`
	Polarization            string    `json:"polarization"`
	LookSide                string    `json:"look_side"`
	PassDirection           string    `json:"pass_direction"`
	PlatformHeadingDeg      float64   `json:"platform_heading_deg"`
	IncidenceAngleDeg       float64   `json:"incidence_angle_deg"`
	IncidenceNearDeg        float64   `json:"incidence_near_deg"`
	IncidenceFarDeg         float64   `json:"incidence_far_deg"`
	OffNadirDeg             float64   `json:"off_nadir_deg"`

	// NESZdB is null rather than 0 when the delivered metadata does not state
	// it, which is the case for the one real scene. The console renders null as
	// "--"; a 0 would read as a measurement.
	NESZdB *float64 `json:"nesz_db"`

	OrbitSource  string       `json:"orbit_source"`
	CenterLatDeg float64      `json:"center_lat_deg"`
	CenterLonDeg float64      `json:"center_lon_deg"`
	Footprint    []Coordinate `json:"footprint"`

	// Quicklook is null for a synthetic scene: there is no product behind it
	// to render, and the console says so rather than showing a placeholder.
	Quicklook *Quicklook `json:"quicklook"`

	// Below here are fields the console does not read yet. They are sent
	// anyway: they are part of the delivered product and the sheet is the
	// natural place for them.
	DurationS          float64 `json:"duration_s"`
	MapProjection      string  `json:"map_projection"`
	ResolutionAzimuthM float64 `json:"resolution_azimuth_m"`
	ResolutionRangeM   float64 `json:"resolution_range_m"`
	Note               string  `json:"note,omitempty"`
}

// Quicklook places a scene's rendered preview on the map. The image itself is
// fetched from /api/v1/scenes/{id}/quicklook.png; this is what the console
// needs to know before it does.
type Quicklook struct {
	// Bounds is west, south, east, north in WGS84 degrees: the image's edges
	// are lines of constant longitude and latitude.
	Bounds   [4]float64 `json:"bounds"`
	MinDb    float64    `json:"min_db"`
	MaxDb    float64    `json:"max_db"`
	WidthPx  int        `json:"width_px"`
	HeightPx int        `json:"height_px"`
}

// ScenesResponse is the list shape.
type ScenesResponse struct {
	Count  int     `json:"count"`
	Scenes []Scene `json:"scenes"`
}

// SceneFromDomain converts one scene for the wire.
func SceneFromDomain(s domain.Scene) Scene {
	footprint := make([]Coordinate, 0, len(s.Footprint))
	for _, c := range s.Footprint {
		footprint = append(footprint, Coordinate{c.LonDeg, c.LatDeg})
	}

	var quicklook *Quicklook
	if q := s.Quicklook; q != nil {
		quicklook = &Quicklook{
			Bounds:   [4]float64{q.West, q.South, q.East, q.North},
			MinDb:    q.MinDb,
			MaxDb:    q.MaxDb,
			WidthPx:  q.WidthPx,
			HeightPx: q.HeightPx,
		}
	}

	return Scene{
		ID:                      s.ID,
		Satellite:               s.Satellite,
		Synthetic:               s.Synthetic,
		AcquiredUTC:             s.AcquiredAt,
		ProductLevel:            s.ProductLevel,
		ImagingMode:             s.ImagingMode,
		RadarBand:               s.Band,
		RadarCenterFrequencyGHz: s.CentreFrequencyGHz,
		Polarization:            s.Polarization,
		LookSide:                string(s.LookSide),
		PassDirection:           string(s.PassDirection),
		PlatformHeadingDeg:      s.PlatformHeadingDeg,
		IncidenceAngleDeg:       s.IncidenceAngleDeg,
		IncidenceNearDeg:        s.IncidenceNearDeg,
		IncidenceFarDeg:         s.IncidenceFarDeg,
		OffNadirDeg:             s.OffNadirDeg,
		NESZdB:                  s.NESZdB,
		OrbitSource:             s.OrbitSource,
		CenterLatDeg:            s.Centre.LatDeg,
		CenterLonDeg:            s.Centre.LonDeg,
		Footprint:               footprint,
		Quicklook:               quicklook,
		DurationS:               s.DurationS,
		MapProjection:           s.MapProjection,
		ResolutionAzimuthM:      s.ResolutionAzimuthM,
		ResolutionRangeM:        s.ResolutionRangeM,
		Note:                    s.Note,
	}
}

// ScenesFromDomain converts a list.
func ScenesFromDomain(in []domain.Scene) ScenesResponse {
	out := make([]Scene, 0, len(in))
	for _, s := range in {
		out = append(out, SceneFromDomain(s))
	}
	return ScenesResponse{Count: len(out), Scenes: out}
}

// Satellite is one constellation member.
type Satellite struct {
	Name           string    `json:"name"`
	NoradID        int       `json:"norad_id"`
	TLEEpochUTC    time.Time `json:"tle_epoch_utc"`
	InclinationDeg float64   `json:"inclination_deg"`
	RAANDeg        float64   `json:"raan_deg"`
	Eccentricity   float64   `json:"eccentricity"`
	PeriodMinutes  float64   `json:"period_minutes"`
	MeanAltitudeKm float64   `json:"mean_altitude_km"`
	OrbitFamily    string    `json:"orbit_family"`
	TLELine1       string    `json:"tle_line1"`
	TLELine2       string    `json:"tle_line2"`
}

// SatellitesResponse is the list shape.
type SatellitesResponse struct {
	Count      int         `json:"count"`
	Satellites []Satellite `json:"satellites"`
}

// SatellitesFromDomain converts a list.
func SatellitesFromDomain(in []domain.Satellite) SatellitesResponse {
	out := make([]Satellite, 0, len(in))
	for _, s := range in {
		out = append(out, Satellite{
			Name:           s.Name,
			NoradID:        s.NoradID,
			TLEEpochUTC:    s.EpochUTC,
			InclinationDeg: s.InclinationDeg,
			RAANDeg:        s.RAANDeg,
			Eccentricity:   s.Eccentricity,
			PeriodMinutes:  s.PeriodMinutes,
			MeanAltitudeKm: s.MeanAltitudeKm,
			OrbitFamily:    string(s.Family()),
			TLELine1:       s.TLELine1,
			TLELine2:       s.TLELine2,
		})
	}
	return SatellitesResponse{Count: len(out), Satellites: out}
}

// Target is one standing ground target.
type Target struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	LatDeg float64 `json:"lat_deg"`
	LonDeg float64 `json:"lon_deg"`
}

// TargetsResponse is the list shape.
type TargetsResponse struct {
	Count   int      `json:"count"`
	Targets []Target `json:"targets"`
}

// TargetsFromDomain converts a list.
func TargetsFromDomain(in []domain.Target) []Target {
	out := make([]Target, 0, len(in))
	for _, t := range in {
		out = append(out, Target{ID: t.ID, Name: t.Name, LatDeg: t.LatDeg, LonDeg: t.LonDeg})
	}
	return out
}

// TrackPoint is one sample of the subsatellite point.
type TrackPoint struct {
	TimeUTC  time.Time `json:"time_utc"`
	LatDeg   float64   `json:"lat_deg"`
	LonDeg   float64   `json:"lon_deg"`
	AltKm    float64   `json:"alt_km"`
	SpeedKmS float64   `json:"speed_km_s"`
}

// GroundTrackResponse is what both services return for a ground track.
type GroundTrackResponse struct {
	Satellite string       `json:"satellite"`
	StartUTC  time.Time    `json:"start_utc"`
	StepS     int          `json:"step_s"`
	Minutes   int          `json:"minutes"`
	Points    []TrackPoint `json:"points"`
}

// GroundTrackFromDomain converts the samples.
func GroundTrackFromDomain(in []domain.GroundTrackPoint) []TrackPoint {
	out := make([]TrackPoint, 0, len(in))
	for _, p := range in {
		out = append(out, TrackPoint{
			TimeUTC:  p.Time,
			LatDeg:   p.LatDeg,
			LonDeg:   p.LonDeg,
			AltKm:    p.AltitudeKm,
			SpeedKmS: p.SpeedKmS,
		})
	}
	return out
}

// GroundTrackToDomain is the other direction, used by scene-service when it
// reads flightdyn-service's answer.
func GroundTrackToDomain(in []TrackPoint) []domain.GroundTrackPoint {
	out := make([]domain.GroundTrackPoint, 0, len(in))
	for _, p := range in {
		out = append(out, domain.GroundTrackPoint{
			Time:       p.TimeUTC,
			LatDeg:     p.LatDeg,
			LonDeg:     p.LonDeg,
			AltitudeKm: p.AltKm,
			SpeedKmS:   p.SpeedKmS,
		})
	}
	return out
}

// AccessWindow is one imaging opportunity. Target is the human-readable name
// because that is what the fixture and the timeline both key on; TargetID is
// sent alongside it so a client can filter without string matching.
type AccessWindow struct {
	Satellite       string    `json:"satellite"`
	Target          string    `json:"target"`
	TargetID        string    `json:"target_id"`
	StartUTC        time.Time `json:"start_utc"`
	EndUTC          time.Time `json:"end_utc"`
	DurationS       float64   `json:"duration_s"`
	BestOffNadirDeg float64   `json:"best_off_nadir_deg"`
	BestAtUTC       time.Time `json:"best_at_utc"`
	LookSide        string    `json:"look_side"`
	PassDirection   string    `json:"pass_direction"`
}

// AccessHorizon is what was swept.
type AccessHorizon struct {
	StartUTC    time.Time `json:"start_utc"`
	Days        float64   `json:"days"`
	CoarseStepS int       `json:"coarse_step_s"`
}

// AccessAssumptions is what the answer rests on. It travels with every access
// response on purpose: these windows are only meaningful next to the steering
// limits and Earth model that produced them, and the console prints the note
// under the timeline.
type AccessAssumptions struct {
	OffNadirMinDeg float64 `json:"off_nadir_min_deg"`
	OffNadirMaxDeg float64 `json:"off_nadir_max_deg"`
	EarthModel     string  `json:"earth_model"`
	Frame          string  `json:"frame"`
	Note           string  `json:"note"`
}

// AccessWindowsResponse mirrors fixtures/access_windows.json.
type AccessWindowsResponse struct {
	Horizon     AccessHorizon     `json:"horizon"`
	Assumptions AccessAssumptions `json:"assumptions"`
	Targets     []Target          `json:"targets"`
	Windows     []AccessWindow    `json:"windows"`
}

// Earth model and frame strings, copied from the fixture notebook 04 wrote so
// that the two are literally the same sentence.
const (
	EarthModel = "WGS84 ellipsoid, target height 0 m"
	Frame      = "SGP4 TEME rotated to ECEF by IAU-1982 GMST; ECEF velocity excludes omega x r"
)

// EnvelopeNote is the caveat the console prints beside every access-window view.
const EnvelopeNote = "Steering envelope is ASSUMED. The SAR Data Product Format Manual is a file " +
	"format spec and does not publish it. Observed value in the StriX-3 sample product: 31.94 deg."

// AssumptionsFor builds the assumptions block for an envelope.
func AssumptionsFor(e domain.OffNadirEnvelope) AccessAssumptions {
	return AccessAssumptions{
		OffNadirMinDeg: e.MinDeg,
		OffNadirMaxDeg: e.MaxDeg,
		EarthModel:     EarthModel,
		Frame:          Frame,
		Note:           EnvelopeNote,
	}
}

// AccessWindowsFromDomain converts the windows.
func AccessWindowsFromDomain(in []domain.AccessWindow) []AccessWindow {
	out := make([]AccessWindow, 0, len(in))
	for _, w := range in {
		out = append(out, AccessWindow{
			Satellite:       w.Satellite,
			Target:          w.TargetName,
			TargetID:        w.TargetID,
			StartUTC:        w.Start,
			EndUTC:          w.End,
			DurationS:       w.Duration().Seconds(),
			BestOffNadirDeg: w.BestOffNadirDeg,
			BestAtUTC:       w.BestAt,
			LookSide:        string(w.LookSide),
			PassDirection:   string(w.PassDirection),
		})
	}
	return out
}

// AccessWindowsToDomain is the other direction, used by scene-service.
func AccessWindowsToDomain(in []AccessWindow) []domain.AccessWindow {
	out := make([]domain.AccessWindow, 0, len(in))
	for _, w := range in {
		out = append(out, domain.AccessWindow{
			Satellite:       w.Satellite,
			TargetID:        w.TargetID,
			TargetName:      w.Target,
			Start:           w.StartUTC,
			End:             w.EndUTC,
			BestOffNadirDeg: w.BestOffNadirDeg,
			BestAt:          w.BestAtUTC,
			LookSide:        domain.LookSide(w.LookSide),
			PassDirection:   domain.PassDirection(w.PassDirection),
		})
	}
	return out
}
