// Package testfixture locates the repository's fixtures/ directory from inside
// any test. Go runs each test with its own package directory as the working
// directory, so a relative path would be different in every package; walking up
// until fixtures/ appears is the same one line everywhere.
package testfixture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Path returns the absolute path of a file inside fixtures/.
func Path(t *testing.T, name string) string {
	t.Helper()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("working directory: %v", err)
	}
	for {
		candidate := filepath.Join(dir, "fixtures", name)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("fixtures/%s not found above %s", name, dir)
		}
		dir = parent
	}
}

// BackendPath returns the absolute path of a file inside backend/, found by
// walking up to the directory holding go.mod. backend/testdata/scenes.json is
// the seed catalog the handler tests serve.
func BackendPath(t *testing.T, relative string) string {
	t.Helper()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("working directory: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Join(dir, relative)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("go.mod not found above %s", dir)
		}
		dir = parent
	}
}

// LoadJSON reads a fixture and unmarshals it into v.
func LoadJSON(t *testing.T, name string, v any) {
	t.Helper()

	raw, err := os.ReadFile(Path(t, name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("parse fixture %s: %v", name, err)
	}
}
