/**
 * The wire-to-domain mapping. These tests are the executable half of the
 * backend contract: if a Go struct tag changes, one of them fails and names the
 * field.
 */
import { describe, expect, it } from 'vitest';
import { toAccessReport, toGroundTrack, toSatellite, toScene } from './mapping';
import { wireAccess, wireAsoScene } from '../testFixtures';

describe('toScene', () => {
  const scene = toScene(wireAsoScene);

  it('renames every snake_case field to camelCase', () => {
    expect(scene.offNadirDeg).toBe(31.94);
    expect(scene.incidenceNearDeg).toBe(34.34);
    expect(scene.incidenceFarDeg).toBe(35.25);
    expect(scene.lookSide).toBe('Left');
    expect(scene.passDirection).toBe('Ascending');
    expect(scene.orbitSource).toBe('Precise');
    expect(scene.neszDb).toBe(-23.5);
    expect(scene.radarCenterFrequencyGhz).toBe(9.65);
  });

  it('parses the acquisition time into a Date, so no component has to', () => {
    expect(scene.acquiredUtc).toBeInstanceOf(Date);
    expect(scene.acquiredUtc.toISOString()).toBe('2026-06-15T06:35:27.000Z');
  });

  it('keeps the footprint as [lon, lat] pairs', () => {
    expect(scene.footprint).toHaveLength(5);
    expect(scene.footprint[0]).toEqual([131.06, 32.86]);
  });

  it('survives a scene with no footprint', () => {
    const bare = toScene({ ...wireAsoScene, footprint: [] });
    expect(bare.footprint).toEqual([]);
  });

  it('carries the synthetic flag through untouched', () => {
    expect(scene.synthetic).toBe(false);
    expect(toScene({ ...wireAsoScene, synthetic: true }).synthetic).toBe(true);
  });
});

describe('toSatellite', () => {
  it('maps the fleet entry', () => {
    const satellite = toSatellite({
      name: 'STRIX-1',
      norad_id: 53815,
      inclination_deg: 97.4388,
      orbit_family: 'near-polar',
      tle_epoch_utc: '2026-09-18T06:06:48Z',
    });
    expect(satellite.noradId).toBe(53815);
    expect(satellite.inclinationDeg).toBe(97.4388);
    expect(satellite.tleEpochUtc.getUTCFullYear()).toBe(2026);
  });
});

describe('toGroundTrack', () => {
  it('maps every point and keeps them in order', () => {
    const track = toGroundTrack({
      satellite: 'STRIX-3',
      start_utc: '2026-09-19T00:00:00Z',
      step_s: 20,
      points: [
        { time_utc: '2026-09-19T00:00:00Z', lat_deg: 1, lon_deg: 2, alt_km: 505 },
        { time_utc: '2026-09-19T00:00:20Z', lat_deg: 3, lon_deg: 4, alt_km: 506 },
      ],
    });
    expect(track.stepS).toBe(20);
    expect(track.points).toHaveLength(2);
    expect(track.points[1]?.altKm).toBe(506);
  });
});

describe('toAccessReport', () => {
  const report = toAccessReport(wireAccess);

  it('maps the horizon and the assumptions block', () => {
    expect(report.horizon.coarseStepS).toBe(20);
    expect(report.assumptions.offNadirMinDeg).toBe(20);
    expect(report.assumptions.note).toContain('ASSUMED');
  });

  it('maps targets and windows', () => {
    expect(report.targets.map((t) => t.id)).toEqual(['aso', 'jakarta']);
    expect(report.windows[0]?.durationS).toBeCloseTo(82.407);
    expect(report.windows[0]?.bestOffNadirDeg).toBeCloseTo(41.579);
  });

  it('parses fractional-second window edges without losing them', () => {
    const start = report.windows[0]?.startUtc;
    expect(start?.toISOString()).toBe('2026-09-19T00:33:08.539Z');
  });
});
