package domain

import (
	"strings"
	"time"
)

// Coordinate is a longitude/latitude pair, in that order, because that is the
// order GeoJSON and Deck.gl use and converting at the boundary is one more
// place to get it backwards.
type Coordinate struct {
	LonDeg float64
	LatDeg float64
}

// Scene is one delivered SAR acquisition. The field names follow the
// vocabulary of the SAR Data Product Format Manual so that a reader who knows
// the products recognises them.
type Scene struct {
	ID                 string
	Satellite          string
	ProductLevel       string // SLC, GRD or ORT
	ImagingMode        string // SlidingSpotlight, Stripmap, Spotlight
	Polarization       string // VV, HH
	Band               string // X
	CentreFrequencyGHz float64
	LookSide           LookSide
	PassDirection      PassDirection
	PlatformHeadingDeg float64 // degrees clockwise from north, as delivered
	IncidenceAngleDeg  float64 // at the scene centre
	IncidenceNearDeg   float64
	IncidenceFarDeg    float64
	OffNadirDeg        float64
	Centre             Coordinate
	Footprint          []Coordinate // closed ring, lon/lat
	AcquiredAt         time.Time
	DurationS          float64
	MapProjection      string
	ResolutionAzimuthM float64
	ResolutionRangeM   float64
	OrbitSource        string // Precise or Predicted

	// NESZdB is a pointer because it is genuinely absent for the one real
	// scene: the delivered metadata quoted in the README does not state it, and
	// inventing a number would defeat the point of shipping a real scene at all.
	// nil means "not stated", which is not the same as 0 dB.
	NESZdB *float64

	// Synthetic marks a scene whose values are illustrative rather than
	// measured. Exactly one scene in this repository is real; the rest exist so
	// the catalog and its filters are worth building. The frontend labels them.
	Synthetic bool

	// Note carries any caveat that belongs with the scene itself, such as how
	// an approximate footprint was derived.
	Note string

	// Quicklook is the rendered preview that exists for a delivered product:
	// the raster in decibels, downsampled, georeferenced so the console can
	// drape it inside the footprint. nil for every synthetic scene, which has
	// no product behind it to render.
	Quicklook *Quicklook
}

// Quicklook describes one rendered preview image. Its edges are lines of
// constant longitude and latitude, so four numbers place it on a map, and the
// stretch is kept so the console can say what black and white mean. The image
// bytes themselves are a blob, not metadata, and come through the repository.
type Quicklook struct {
	West, South, East, North float64 // WGS84 degrees
	MinDb, MaxDb             float64 // the gamma0 values rendered black and white
	WidthPx, HeightPx        int
}

// SceneFilter is the set of optional catalog filters. An empty string means
// "do not filter on this field".
type SceneFilter struct {
	Mode           string
	Polarization   string
	OrbitDirection string
}

// Matches applies the filter. Kept in the domain because "what counts as a
// match" is a rule about scenes, not about HTTP query strings.
func (f SceneFilter) Matches(s Scene) bool {
	if f.Mode != "" && !strings.EqualFold(s.ImagingMode, f.Mode) {
		return false
	}
	if f.Polarization != "" && !strings.EqualFold(s.Polarization, f.Polarization) {
		return false
	}
	if f.OrbitDirection != "" && !strings.EqualFold(string(s.PassDirection), f.OrbitDirection) {
		return false
	}
	return true
}
