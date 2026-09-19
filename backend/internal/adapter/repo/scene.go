package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// SceneFile is a SceneRepository backed by a JSON seed file. Twelve scenes fit
// in memory comfortably, so the file is read once at startup and never touched
// again; the same interface is what a BigQuery implementation would satisfy.
type SceneFile struct {
	scenes []domain.Scene
	byID   map[string]domain.Scene
}

// sceneDocument and sceneRecord are the on-disk shape. They are separate from
// domain.Scene on purpose: the domain should not have to know that it is stored
// as JSON, and keeping the two apart means the file format can change without
// the rest of the backend noticing.
type sceneDocument struct {
	Note   string        `json:"note"`
	Scenes []sceneRecord `json:"scenes"`
}

type sceneRecord struct {
	ID                 string   `json:"id"`
	Satellite          string   `json:"satellite"`
	ProductLevel       string   `json:"product_level"`
	ImagingMode        string   `json:"imaging_mode"`
	Polarization       string   `json:"polarization"`
	Band               string   `json:"band"`
	CentreFrequencyGHz float64  `json:"centre_frequency_ghz"`
	LookSide           string   `json:"look_side"`
	PassDirection      string   `json:"pass_direction"`
	PlatformHeadingDeg float64  `json:"platform_heading_deg"`
	IncidenceAngleDeg  float64  `json:"incidence_angle_deg"`
	IncidenceNearDeg   float64  `json:"incidence_near_deg"`
	IncidenceFarDeg    float64  `json:"incidence_far_deg"`
	OffNadirDeg        float64  `json:"off_nadir_deg"`
	Centre             coordRec `json:"centre"`
	// Footprint is a closed ring of [longitude, latitude] pairs, the order
	// GeoJSON and Deck.gl both use.
	Footprint          [][2]float64 `json:"footprint"`
	AcquiredAt         time.Time    `json:"acquired_at"`
	DurationS          float64      `json:"duration_s"`
	MapProjection      string       `json:"map_projection"`
	ResolutionAzimuthM float64      `json:"resolution_azimuth_m"`
	ResolutionRangeM   float64      `json:"resolution_range_m"`
	OrbitSource        string       `json:"orbit_source"`
	NESZdB             *float64     `json:"nesz_db"`
	Synthetic          bool         `json:"synthetic"`
	Note               string       `json:"note"`
}

type coordRec struct {
	LonDeg float64 `json:"lon_deg"`
	LatDeg float64 `json:"lat_deg"`
}

// LoadSceneFile reads the seed catalog.
func LoadSceneFile(path string) (*SceneFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read scene file %s: %w", path, err)
	}

	var doc sceneDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("parse scene file %s: %w", path, err)
	}
	if len(doc.Scenes) == 0 {
		return nil, fmt.Errorf("scene file %s contains no scenes", path)
	}

	scenes := make([]domain.Scene, 0, len(doc.Scenes))
	byID := make(map[string]domain.Scene, len(doc.Scenes))
	for _, r := range doc.Scenes {
		s := r.toDomain()
		scenes = append(scenes, s)
		byID[s.ID] = s
	}

	// Newest first, which is the order an operator expects a catalog in.
	sort.Slice(scenes, func(i, j int) bool { return scenes[i].AcquiredAt.After(scenes[j].AcquiredAt) })

	return &SceneFile{scenes: scenes, byID: byID}, nil
}

// List implements port.SceneRepository.
func (f *SceneFile) List(_ context.Context, filter domain.SceneFilter) ([]domain.Scene, error) {
	out := make([]domain.Scene, 0, len(f.scenes))
	for _, s := range f.scenes {
		if filter.Matches(s) {
			out = append(out, s)
		}
	}
	return out, nil
}

// Get implements port.SceneRepository.
func (f *SceneFile) Get(_ context.Context, id string) (domain.Scene, error) {
	s, ok := f.byID[id]
	if !ok {
		return domain.Scene{}, port.NotFoundError{Message: "scene " + id + " not found"}
	}
	return s, nil
}

func (r sceneRecord) toDomain() domain.Scene {
	footprint := make([]domain.Coordinate, 0, len(r.Footprint))
	for _, p := range r.Footprint {
		footprint = append(footprint, domain.Coordinate{LonDeg: p[0], LatDeg: p[1]})
	}

	return domain.Scene{
		ID:                 r.ID,
		Satellite:          r.Satellite,
		ProductLevel:       r.ProductLevel,
		ImagingMode:        r.ImagingMode,
		Polarization:       r.Polarization,
		Band:               r.Band,
		CentreFrequencyGHz: r.CentreFrequencyGHz,
		LookSide:           domain.LookSide(r.LookSide),
		PassDirection:      domain.PassDirection(r.PassDirection),
		PlatformHeadingDeg: r.PlatformHeadingDeg,
		IncidenceAngleDeg:  r.IncidenceAngleDeg,
		IncidenceNearDeg:   r.IncidenceNearDeg,
		IncidenceFarDeg:    r.IncidenceFarDeg,
		OffNadirDeg:        r.OffNadirDeg,
		Centre:             domain.Coordinate{LonDeg: r.Centre.LonDeg, LatDeg: r.Centre.LatDeg},
		Footprint:          footprint,
		AcquiredAt:         r.AcquiredAt.UTC(),
		DurationS:          r.DurationS,
		MapProjection:      r.MapProjection,
		ResolutionAzimuthM: r.ResolutionAzimuthM,
		ResolutionRangeM:   r.ResolutionRangeM,
		OrbitSource:        r.OrbitSource,
		NESZdB:             r.NESZdB,
		Synthetic:          r.Synthetic,
		Note:               r.Note,
	}
}
