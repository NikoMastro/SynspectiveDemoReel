/**
 * Pure derivations over the fetched data. No React, no fetch - every function
 * here takes data in and returns data out, which is why they are all directly
 * unit-tested.
 */
import type { AccessWindow, Scene, SceneFilters, TimeRange } from '../interfaces';

export const NO_FILTERS: SceneFilters = {
  satellite: null,
  imagingMode: null,
  passDirection: null,
  lookSide: null,
};

/** A scene is kept only if it matches every filter that is set. */
export function applyFilters(scenes: Scene[], filters: SceneFilters): Scene[] {
  return scenes.filter(
    (s) =>
      (filters.satellite === null || s.satellite === filters.satellite) &&
      (filters.imagingMode === null || s.imagingMode === filters.imagingMode) &&
      (filters.passDirection === null || s.passDirection === filters.passDirection) &&
      (filters.lookSide === null || s.lookSide === filters.lookSide),
  );
}

/**
 * The filters that mean something for an opportunity.
 *
 * Three of the four carry over: an access window names its satellite, which
 * side the radar would look and whether the pass is ascending. Imaging mode
 * does not - it is chosen when an acquisition is ordered, and an opportunity is
 * the chance to order one. Filtering by mode therefore narrows the catalog and
 * leaves this view alone, which the timeline says out loud rather than leaving
 * the reader to wonder why the bars did not move.
 */
export function filterWindows(windows: AccessWindow[], filters: SceneFilters): AccessWindow[] {
  return windows.filter(
    (w) =>
      (filters.satellite === null || w.satellite === filters.satellite) &&
      (filters.passDirection === null || w.passDirection === filters.passDirection) &&
      (filters.lookSide === null || w.lookSide === filters.lookSide),
  );
}

/** True when a filter is set that the access-window view cannot honour. */
export function hasSceneOnlyFilter(filters: SceneFilters): boolean {
  return filters.imagingMode !== null;
}

export function countActiveFilters(filters: SceneFilters): number {
  return Object.values(filters).filter((v) => v !== null).length;
}

export interface FilterOptions {
  satellite: string[];
  imagingMode: string[];
  passDirection: string[];
  lookSide: string[];
}

const distinctSorted = (values: string[]): string[] =>
  [...new Set(values.filter((v) => v !== ''))].sort();

/**
 * The dropdown contents come from the data, not from a hardcoded list: if the
 * catalog gains a mode the filter gains it too, and a filter can never offer a
 * value that would select nothing.
 */
export function filterOptions(scenes: Scene[]): FilterOptions {
  return {
    satellite: distinctSorted(scenes.map((s) => s.satellite)),
    imagingMode: distinctSorted(scenes.map((s) => s.imagingMode)),
    passDirection: distinctSorted(scenes.map((s) => s.passDirection)),
    lookSide: distinctSorted(scenes.map((s) => s.lookSide)),
  };
}

/** Windows that overlap the brushed range at all, not only those contained in it. */
export function windowsInRange(windows: AccessWindow[], range: TimeRange | null): AccessWindow[] {
  if (range === null) return windows;
  const from = range.from.getTime();
  const to = range.to.getTime();
  return windows.filter((w) => w.endUtc.getTime() >= from && w.startUtc.getTime() <= to);
}

/** Opportunity count per target name - what the map sizes its target markers by. */
export function countWindowsByTarget(windows: AccessWindow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of windows) counts.set(w.target, (counts.get(w.target) ?? 0) + 1);
  return counts;
}

/** Same, per satellite - the number shown next to each legend chip. */
export function countWindowsBySatellite(windows: AccessWindow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of windows) counts.set(w.satellite, (counts.get(w.satellite) ?? 0) + 1);
  return counts;
}
