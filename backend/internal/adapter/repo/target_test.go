package repo_test

import (
	"context"
	"testing"

	"github.com/nikomastro/strix-scene-explorer/backend/internal/adapter/repo"
)

func TestTargetsByIDs(t *testing.T) {
	targets := repo.NewTargets()

	tests := []struct {
		name    string
		ids     []string
		want    []string
		wantErr bool
	}{
		{name: "one id", ids: []string{"aso"}, want: []string{"aso"}},
		{name: "several, sorted for a stable response", ids: []string{"tokyo", "aso"}, want: []string{"aso", "tokyo"}},
		{name: "case and padding are forgiven", ids: []string{" ASO "}, want: []string{"aso"}},
		{name: "an unknown id is an error, not a shorter answer", ids: []string{"aso", "nope"}, wantErr: true},

		// The access sweep costs len(satellites) * len(targets) * steps, so a
		// repeated id used to multiply the whole fan-out for an identical
		// answer. Measured on the deployed service before this: 40 copies of
		// "aso" took 15.9s against 0.21s for one.
		{name: "repeats collapse", ids: []string{"aso", "aso", "aso"}, want: []string{"aso"}},
		{name: "repeats collapse across different spellings", ids: []string{"aso", "ASO", " aso "}, want: []string{"aso"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := targets.ByIDs(context.Background(), tc.ids)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ByIDs(%v) = %v, want an error", tc.ids, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ByIDs(%v): %v", tc.ids, err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("ByIDs(%v) returned %d targets, want %d", tc.ids, len(got), len(tc.want))
			}
			for i, id := range tc.want {
				if got[i].ID != id {
					t.Errorf("target %d = %q, want %q", i, got[i].ID, id)
				}
			}
		})
	}
}
