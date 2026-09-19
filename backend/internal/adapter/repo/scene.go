package repo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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

	// images holds the encoded quicklook PNG of every scene that has one,
	// read at startup like the rest. One scene, under a megabyte: keeping it
	// in memory is simpler than re-reading a file per request, and a bucket
	// implementation would replace this map with a fetch.
	images map[string][]byte
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
	// Quicklook is absent for every synthetic scene.
	Quicklook *quicklookRec `json:"quicklook"`
}

type coordRec struct {
	LonDeg float64 `json:"lon_deg"`
	LatDeg float64 `json:"lat_deg"`
}

// quicklookRec is written by scripts/make_quicklook.py. File is relative to
// the scene file, so the seed and its images move together.
type quicklookRec struct {
	File     string     `json:"file"`
	Bounds   [4]float64 `json:"bounds"` // west, south, east, north
	MinDb    float64    `json:"min_db"`
	MaxDb    float64    `json:"max_db"`
	WidthPx  int        `json:"width_px"`
	HeightPx int        `json:"height_px"`
}

// pngSignature is the first eight bytes of every PNG file. Checking it at
// startup turns "the wrong file was committed" into a refusal to start rather
// than a broken image in the browser.
var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// validate rejects a quicklook block that would place an image somewhere it
// does not belong.
//
// Bounds is a [4]float64, and Go fills a fixed-size array with zeros for
// whatever JSON did not supply. So a bounds array that lost an entry does not
// fail to parse: it parses into a north edge of 0, and the console draws the
// scene stretched down to the equator. Checking the ordering catches that, an
// east and west the wrong way round, and a block of all zeros.
func (q quicklookRec) validate() error {
	if q.Bounds[0] >= q.Bounds[2] || q.Bounds[1] >= q.Bounds[3] {
		return fmt.Errorf("quicklook bounds %v are not west < east, south < north", q.Bounds)
	}
	if q.WidthPx <= 0 || q.HeightPx <= 0 {
		return fmt.Errorf("quicklook is %dx%d px, which is not an image", q.WidthPx, q.HeightPx)
	}
	return nil
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
	images := make(map[string][]byte)
	for _, r := range doc.Scenes {
		s := r.toDomain()
		scenes = append(scenes, s)
		byID[s.ID] = s

		if r.Quicklook != nil {
			if err := r.Quicklook.validate(); err != nil {
				return nil, fmt.Errorf("scene %s: %w", r.ID, err)
			}
			img, err := readPNG(filepath.Join(filepath.Dir(path), r.Quicklook.File))
			if err != nil {
				return nil, fmt.Errorf("scene %s: %w", r.ID, err)
			}
			images[s.ID] = img
		}
	}

	// Newest first, which is the order an operator expects a catalog in.
	sort.Slice(scenes, func(i, j int) bool { return scenes[i].AcquiredAt.After(scenes[j].AcquiredAt) })

	return &SceneFile{scenes: scenes, byID: byID, images: images}, nil
}

// readPNG reads a file and checks it really is a PNG before anyone serves it.
func readPNG(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read quicklook %s: %w", path, err)
	}
	if !bytes.HasPrefix(raw, pngSignature) {
		return nil, fmt.Errorf("quicklook %s is not a PNG file", path)
	}
	return raw, nil
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

// QuicklookImage implements port.SceneRepository. A scene without a quicklook
// is a 404 at the HTTP layer, the same as a scene that does not exist: from the
// browser's side there is no image at that URL either way.
func (f *SceneFile) QuicklookImage(_ context.Context, id string) ([]byte, error) {
	img, ok := f.images[id]
	if !ok {
		return nil, port.NotFoundError{Message: "scene " + id + " has no quicklook"}
	}
	return img, nil
}

func (r sceneRecord) toDomain() domain.Scene {
	footprint := make([]domain.Coordinate, 0, len(r.Footprint))
	for _, p := range r.Footprint {
		footprint = append(footprint, domain.Coordinate{LonDeg: p[0], LatDeg: p[1]})
	}

	var quicklook *domain.Quicklook
	if q := r.Quicklook; q != nil {
		quicklook = &domain.Quicklook{
			West: q.Bounds[0], South: q.Bounds[1], East: q.Bounds[2], North: q.Bounds[3],
			MinDb: q.MinDb, MaxDb: q.MaxDb,
			WidthPx: q.WidthPx, HeightPx: q.HeightPx,
		}
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
		Quicklook:          quicklook,
	}
}
