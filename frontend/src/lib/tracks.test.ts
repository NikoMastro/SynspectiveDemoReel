import { describe, expect, it } from 'vitest';
import { splitAtAntimeridian, subSatellitePoint, subSatellitePoints, trackPositions } from './tracks';
import { straightTrack, wrappingTrack } from '../testFixtures';

describe('splitAtAntimeridian', () => {
  it('leaves a track that never wraps in one piece', () => {
    expect(splitAtAntimeridian([[10, 0], [20, 1], [30, 2]])).toEqual([
      [[10, 0], [20, 1], [30, 2]],
    ]);
  });

  it('breaks the path where longitude jumps by more than 180 degrees', () => {
    expect(
      splitAtAntimeridian([[170, 0], [179, 1], [-179, 2], [-170, 3]]),
    ).toEqual([
      [[170, 0], [179, 1]],
      [[-179, 2], [-170, 3]],
    ]);
  });

  it('drops a one-point remainder, because a single point is not a line', () => {
    expect(splitAtAntimeridian([[179, 0], [-179, 1]])).toEqual([]);
  });

  it('handles an empty track', () => {
    expect(splitAtAntimeridian([])).toEqual([]);
  });

  it('does not split on an ordinary step', () => {
    // A satellite moves about 0.07 deg of longitude per second, so no genuine
    // 20 s step comes anywhere near the 180 deg threshold.
    expect(splitAtAntimeridian([[0, 0], [1.4, 0.5]])).toHaveLength(1);
  });
});

describe('trackPositions', () => {
  it('emits [longitude, latitude], the order deck.gl expects', () => {
    expect(trackPositions(straightTrack)[0]).toEqual([130, 30]);
  });
});

describe('subSatellitePoint', () => {
  it('picks the propagated point nearest the requested instant', () => {
    const point = subSatellitePoint(straightTrack, new Date('2026-09-19T00:01:05Z'));
    expect(point?.lonDeg).toBe(135);
    expect(point?.clamped).toBe(false);
  });

  it('clamps to the track end and flags it when the instant is outside the arc', () => {
    const point = subSatellitePoint(straightTrack, new Date('2026-09-19T06:00:00Z'));
    expect(point?.lonDeg).toBe(140);
    expect(point?.clamped).toBe(true);
  });

  it('clamps at the start too', () => {
    const point = subSatellitePoint(straightTrack, new Date('2026-09-18T00:00:00Z'));
    expect(point?.lonDeg).toBe(130);
    expect(point?.clamped).toBe(true);
  });

  it('returns null for a track with no points', () => {
    expect(subSatellitePoint({ ...straightTrack, points: [] }, new Date())).toBeNull();
  });

  it('drops empty tracks rather than emitting a marker at 0,0', () => {
    const points = subSatellitePoints(
      [straightTrack, { ...wrappingTrack, points: [] }],
      new Date('2026-09-19T00:00:00Z'),
    );
    expect(points.map((p) => p.satellite)).toEqual(['STRIX-3']);
  });
});
