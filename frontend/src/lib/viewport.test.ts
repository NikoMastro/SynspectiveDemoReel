import { describe, expect, it } from 'vitest';
import { FALLBACK_SIZE, fitFootprint, footprintBounds, MAX_FIT_ZOOM, quicklookResolutionM } from './viewport';
import { asoScene } from '../testFixtures';

const quicklook = asoScene.quicklook;
if (quicklook === null) throw new Error('the Aso fixture must carry a quicklook');

describe('footprintBounds', () => {
  it('finds the corners of a ring', () => {
    expect(footprintBounds(asoScene.footprint)).toEqual([
      [131.06, 32.86],
      [131.13, 32.92],
    ]);
  });

  it('is null for an empty ring', () => {
    expect(footprintBounds([])).toBeNull();
  });
});

describe('fitFootprint', () => {
  it('centres on the footprint and zooms close enough to see it', () => {
    const target = fitFootprint(asoScene.footprint, { width: 800, height: 600 });

    expect(target?.longitude).toBeCloseTo(131.095, 2);
    expect(target?.latitude).toBeCloseTo(32.89, 2);
    // A 7 km footprint on an 800 px canvas: town scale, not world scale.
    expect(target?.zoom).toBeGreaterThan(10);
    expect(target?.zoom).toBeLessThanOrEqual(MAX_FIT_ZOOM);
  });

  // The quicklook has 10 m pixels. Fitting a tiny footprint would otherwise
  // zoom to where each of them is a visible square.
  it('never zooms past the quicklook resolution', () => {
    const tiny = fitFootprint(
      [
        [131.09, 32.88],
        [131.091, 32.88],
        [131.091, 32.881],
        [131.09, 32.881],
        [131.09, 32.88],
      ],
      { width: 800, height: 600 },
    );
    expect(tiny?.zoom).toBe(MAX_FIT_ZOOM);
  });

  it('falls back to a default canvas when it cannot be measured', () => {
    expect(fitFootprint(asoScene.footprint, { width: 0, height: 0 })).toEqual(
      fitFootprint(asoScene.footprint, FALLBACK_SIZE),
    );
  });

  it('has nowhere to go for an empty ring', () => {
    expect(fitFootprint([], { width: 800, height: 600 })).toBeNull();
  });
});

describe('quicklookResolutionM', () => {
  // 0.1607 degrees of longitude at 32.9 N is about 15.0 km, over 1400 pixels.
  it('reports about ten metres per pixel for the Mt. Aso quicklook', () => {
    const metres = quicklookResolutionM(quicklook);
    expect(metres).toBeGreaterThan(10);
    expect(metres).toBeLessThan(11.5);
  });
});
