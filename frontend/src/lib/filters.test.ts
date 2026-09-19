import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  countActiveFilters,
  countWindowsBySatellite,
  countWindowsByTarget,
  filterOptions,
  NO_FILTERS,
  windowsInRange,
} from './filters';
import { asoScene, sampleAccess, sampleScenes, syntheticScene } from '../testFixtures';

describe('applyFilters', () => {
  it('returns everything when nothing is set', () => {
    expect(applyFilters(sampleScenes, NO_FILTERS)).toHaveLength(2);
  });

  it('filters on a single field', () => {
    expect(applyFilters(sampleScenes, { ...NO_FILTERS, satellite: 'STRIX-3' })).toEqual([asoScene]);
    expect(applyFilters(sampleScenes, { ...NO_FILTERS, lookSide: 'Right' })).toEqual([syntheticScene]);
  });

  it('ANDs the filters together', () => {
    expect(
      applyFilters(sampleScenes, {
        ...NO_FILTERS,
        satellite: 'STRIX-3',
        passDirection: 'Descending',
      }),
    ).toEqual([]);
  });

  it('counts how many filters are active, for the reset button', () => {
    expect(countActiveFilters(NO_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...NO_FILTERS, satellite: 'STRIX-3', lookSide: 'Left' })).toBe(2);
  });
});

describe('filterOptions', () => {
  it('derives the options from the catalog, sorted and de-duplicated', () => {
    expect(filterOptions(sampleScenes)).toEqual({
      satellite: ['STRIX-3', 'STRIX-5'],
      imagingMode: ['Sliding Spotlight', 'Stripmap'],
      passDirection: ['Ascending', 'Descending'],
      lookSide: ['Left', 'Right'],
    });
  });

  it('offers nothing when the catalog is empty', () => {
    expect(filterOptions([]).satellite).toEqual([]);
  });
});

describe('windowsInRange', () => {
  const windows = sampleAccess.windows;

  it('returns everything when no range is brushed', () => {
    expect(windowsInRange(windows, null)).toHaveLength(3);
  });

  it('keeps windows that merely overlap the range, not only those inside it', () => {
    // The range starts mid-window; the window still counts as reachable.
    const range = {
      from: new Date('2026-09-19T00:34:00Z'),
      to: new Date('2026-09-19T01:00:00Z'),
    };
    expect(windowsInRange(windows, range).map((w) => w.satellite)).toEqual(['STRIX-5']);
  });

  it('returns nothing for a range with no opportunities', () => {
    expect(
      windowsInRange(windows, {
        from: new Date('2026-09-25T00:00:00Z'),
        to: new Date('2026-09-26T00:00:00Z'),
      }),
    ).toEqual([]);
  });
});

describe('counting', () => {
  it('counts opportunities per target', () => {
    const counts = countWindowsByTarget(sampleAccess.windows);
    expect(counts.get('Mt. Aso, JP')).toBe(1);
    expect(counts.get('Jakarta, ID')).toBe(1);
    expect(counts.get('Tokyo, JP')).toBeUndefined();
  });

  it('counts opportunities per satellite, which is what the legend shows', () => {
    const counts = countWindowsBySatellite(sampleAccess.windows);
    expect(counts.get('STRIX-3')).toBe(2);
    expect(counts.get('STRIX-5')).toBe(1);
  });
});
