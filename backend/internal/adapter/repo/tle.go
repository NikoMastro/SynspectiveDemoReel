// Package repo holds the file-backed implementations of the repository ports.
// They read the same fixtures the notebooks produced, which is what lets the Go
// services and the Python analysis be compared at all. A BigQuery or Cloud
// Storage implementation would sit beside these and satisfy the same interface.
package repo

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
)

// TLEFile is a SatelliteRepository backed by a three-line-per-satellite TLE
// text file, the format Celestrak serves. The file is read once at startup and
// held in memory: it is eight satellites, it never changes while the process
// runs, and reading it up front means a bad file fails the service on boot
// instead of on the first request.
type TLEFile struct {
	satellites []domain.Satellite
	byName     map[string]domain.Satellite
}

// LoadTLEFile reads and parses a TLE file.
func LoadTLEFile(path string) (*TLEFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read TLE file %s: %w", path, err)
	}

	sats, err := parseTLEs(string(raw))
	if err != nil {
		return nil, fmt.Errorf("parse TLE file %s: %w", path, err)
	}
	if len(sats) == 0 {
		return nil, fmt.Errorf("TLE file %s contains no satellites", path)
	}

	sort.Slice(sats, func(i, j int) bool { return sats[i].Name < sats[j].Name })

	byName := make(map[string]domain.Satellite, len(sats))
	for _, s := range sats {
		byName[strings.ToUpper(s.Name)] = s
	}
	return &TLEFile{satellites: sats, byName: byName}, nil
}

// All implements port.SatelliteRepository.
func (f *TLEFile) All(_ context.Context) ([]domain.Satellite, error) {
	// Copy so a caller cannot reorder the repository's own slice underneath
	// another request.
	out := make([]domain.Satellite, len(f.satellites))
	copy(out, f.satellites)
	return out, nil
}

// ByName implements port.SatelliteRepository. Lookup is case-insensitive
// because a query string is typed by a human.
func (f *TLEFile) ByName(_ context.Context, name string) (domain.Satellite, error) {
	s, ok := f.byName[strings.ToUpper(strings.TrimSpace(name))]
	if !ok {
		return domain.Satellite{}, port.NotFoundError{Message: "satellite " + name + " not found"}
	}
	return s, nil
}

// parseTLEs walks the file three lines at a time: name, line 1, line 2.
func parseTLEs(text string) ([]domain.Satellite, error) {
	var lines []string
	for _, l := range strings.Split(text, "\n") {
		if trimmed := strings.TrimRight(l, " \r\t"); strings.TrimSpace(trimmed) != "" {
			lines = append(lines, trimmed)
		}
	}
	if len(lines)%3 != 0 {
		return nil, fmt.Errorf("expected groups of 3 lines, got %d lines", len(lines))
	}

	var sats []domain.Satellite
	for i := 0; i < len(lines); i += 3 {
		s, err := parseTLE(strings.TrimSpace(lines[i]), lines[i+1], lines[i+2])
		if err != nil {
			return nil, err
		}
		sats = append(sats, s)
	}
	return sats, nil
}

// parseTLE reads the handful of fields the console displays. A TLE is a
// fixed-column format, so the substrings below are the format, not a guess; the
// comments give the column numbers as the NORAD specification numbers them
// (1-based), while Go slices are 0-based.
func parseTLE(name, line1, line2 string) (domain.Satellite, error) {
	if len(line1) < 63 || len(line2) < 63 {
		return domain.Satellite{}, fmt.Errorf("%s: TLE lines are too short", name)
	}

	norad, err := strconv.Atoi(strings.TrimSpace(line1[2:7])) // columns 3-7
	if err != nil {
		return domain.Satellite{}, fmt.Errorf("%s: catalog number: %w", name, err)
	}

	epoch, err := parseTLEEpoch(line1)
	if err != nil {
		return domain.Satellite{}, fmt.Errorf("%s: %w", name, err)
	}

	inclination, err := parseField(line2[8:16]) // columns 9-16
	if err != nil {
		return domain.Satellite{}, fmt.Errorf("%s: inclination: %w", name, err)
	}
	raan, err := parseField(line2[17:25]) // columns 18-25
	if err != nil {
		return domain.Satellite{}, fmt.Errorf("%s: RAAN: %w", name, err)
	}
	// Columns 27-33 hold the eccentricity with the leading decimal point left
	// out, so it has to be put back.
	eccentricity, err := parseField("." + line2[26:33])
	if err != nil {
		return domain.Satellite{}, fmt.Errorf("%s: eccentricity: %w", name, err)
	}
	meanMotion, err := parseField(line2[52:63]) // columns 53-63, revolutions per day
	if err != nil {
		return domain.Satellite{}, fmt.Errorf("%s: mean motion: %w", name, err)
	}

	period, altitude := domain.OrbitSizeFromMeanMotion(meanMotion)

	return domain.Satellite{
		Name:           name,
		NoradID:        norad,
		TLELine1:       line1,
		TLELine2:       line2,
		EpochUTC:       epoch,
		InclinationDeg: inclination,
		RAANDeg:        raan,
		Eccentricity:   eccentricity,
		PeriodMinutes:  period,
		MeanAltitudeKm: altitude,
	}, nil
}

// parseTLEEpoch reads columns 19-32: a two-digit year followed by the day of
// the year with a fractional part. Years below 57 mean the 2000s, which is the
// convention the format has carried since it was designed around Sputnik.
func parseTLEEpoch(line1 string) (time.Time, error) {
	year, err := strconv.Atoi(strings.TrimSpace(line1[18:20]))
	if err != nil {
		return time.Time{}, fmt.Errorf("epoch year: %w", err)
	}
	if year < 57 {
		year += 2000
	} else {
		year += 1900
	}

	dayOfYear, err := parseField(line1[20:32])
	if err != nil {
		return time.Time{}, fmt.Errorf("epoch day: %w", err)
	}

	// Day 1.0 is midnight on 1 January, so the offset from the start of the
	// year is dayOfYear - 1.
	start := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
	return start.Add(time.Duration((dayOfYear - 1) * float64(24*time.Hour))), nil
}

func parseField(s string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(s), 64)
}
