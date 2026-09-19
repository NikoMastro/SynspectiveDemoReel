package repo_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/domain"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/port"
	"github.com/nikomastro/strix-scene-explorer/backend/internal/testfixture"
)

const realSceneID = "STRIX3-20260615T063527Z-SL1"

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

func loadSeed(t *testing.T) *repo.SceneFile {
	t.Helper()

	scenes, err := repo.LoadSceneFile(testfixture.BackendPath(t, "testdata/scenes.json"))
	if err != nil {
		t.Fatalf("load scenes: %v", err)
	}
	return scenes
}

// The quicklook and the footprint are derived from the same raster by the same
// script, so this test holds them to each other: every vertex of the polygon
// must fall inside the image's edges, and the edges must be over Mt. Aso.
func TestSceneFileCarriesTheQuicklook(t *testing.T) {
	scenes := loadSeed(t)

	real, err := scenes.Get(context.Background(), realSceneID)
	if err != nil {
		t.Fatalf("get the real scene: %v", err)
	}

	q := real.Quicklook
	if q == nil {
		t.Fatal("the delivered product has a quicklook and the seed must say so")
	}
	if q.West >= q.East || q.South >= q.North {
		t.Errorf("bounds are not west < east, south < north: %+v", *q)
	}
	// Mt. Aso is at 32.89 N, 131.09 E. A raster placed anywhere else is a
	// reprojection gone wrong, and it would still draw.
	if q.West < 130.9 || q.East > 131.3 || q.South < 32.7 || q.North > 33.0 {
		t.Errorf("bounds are not over Mt. Aso: %+v", *q)
	}
	if q.MinDb >= q.MaxDb {
		t.Errorf("stretch %.2f..%.2f dB has black above white", q.MinDb, q.MaxDb)
	}
	if q.WidthPx <= 0 || q.HeightPx <= 0 {
		t.Errorf("image size %dx%d", q.WidthPx, q.HeightPx)
	}

	for i, c := range real.Footprint {
		if c.LonDeg < q.West || c.LonDeg > q.East || c.LatDeg < q.South || c.LatDeg > q.North {
			t.Errorf("footprint vertex %d (%.6f, %.6f) lies outside the image bounds", i, c.LonDeg, c.LatDeg)
		}
	}

	img, err := scenes.QuicklookImage(context.Background(), realSceneID)
	if err != nil {
		t.Fatalf("quicklook image: %v", err)
	}
	if !bytes.HasPrefix(img, pngSignature) {
		t.Error("the quicklook bytes do not start with the PNG signature")
	}
}

func TestSceneFileHasNoQuicklookForSyntheticScenes(t *testing.T) {
	scenes := loadSeed(t)

	all, err := scenes.List(context.Background(), domain.SceneFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	checked := 0
	for _, s := range all {
		if !s.Synthetic {
			continue
		}
		checked++
		if s.Quicklook != nil {
			t.Errorf("%s is synthetic and must not claim a quicklook", s.ID)
		}

		_, err := scenes.QuicklookImage(context.Background(), s.ID)
		var notFound port.NotFoundError
		if !errors.As(err, &notFound) {
			t.Errorf("%s: want NotFoundError for the image, got %v", s.ID, err)
		}
	}
	if checked == 0 {
		t.Fatal("no synthetic scene in the seed, so this proves nothing")
	}
}

// A catalog that names an image it cannot serve should not start. Both ways
// that can happen are covered: the file is missing, and the file is there but
// is not a PNG.
func TestLoadSceneFileRefusesABrokenQuicklook(t *testing.T) {
	const catalog = `{"scenes":[{"id":"X","acquired_at":"2026-01-01T00:00:00Z",` +
		`"quicklook":{"file":"quicklook/x.png","bounds":[0,0,1,1],"min_db":-10,"max_db":0,"width_px":1,"height_px":1}}]}`

	cases := []struct {
		name  string
		setup func(t *testing.T, dir string)
	}{
		{"missing file", func(*testing.T, string) {}},
		{"not a PNG", func(t *testing.T, dir string) {
			if err := os.WriteFile(filepath.Join(dir, "quicklook", "x.png"), []byte("hello"), 0o644); err != nil {
				t.Fatal(err)
			}
		}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.Mkdir(filepath.Join(dir, "quicklook"), 0o755); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, "scenes.json")
			if err := os.WriteFile(path, []byte(catalog), 0o644); err != nil {
				t.Fatal(err)
			}
			c.setup(t, dir)

			_, err := repo.LoadSceneFile(path)
			if err == nil {
				t.Fatal("loaded a catalog whose quicklook cannot be served")
			}
			if !bytes.Contains([]byte(err.Error()), []byte("scene X")) {
				t.Errorf("the error should name the scene: %v", err)
			}
		})
	}
}
