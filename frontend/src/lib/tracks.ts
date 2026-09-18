/**
 * Ground-track geometry. Two jobs, both pure.
 */
import type { GroundTrack, Position2D, SubSatellitePoint } from '../interfaces';

/**
 * Split a track wherever it crosses the antimeridian.
 *
 * A ground track is a sequence of longitudes that jumps from +179 to -179 once
 * per orbit. Drawn as one path that jump becomes a line straight across the
 * whole map. Notebook 03 breaks the series with a NaN for the same reason;
 * deck.gl has no NaN convention, so we hand it several paths instead.
 *
 * Any step larger than 180 degrees is a wrap: a satellite moves roughly 0.07
 * degrees of longitude per second, so no real step comes close.
 */
export function splitAtAntimeridian(points: Position2D[]): Position2D[][] {
  const segments: Position2D[][] = [];
  let current: Position2D[] = [];

  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous !== undefined && Math.abs(point[0] - previous[0]) > 180) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);

  // A single point is not a line; dropping it keeps PathLayer's data honest.
  return segments.filter((segment) => segment.length > 1);
}

export function trackPositions(track: GroundTrack): Position2D[] {
  return track.points.map((p) => [p.lonDeg, p.latDeg] as Position2D);
}

/**
 * The satellite's position at a given instant, taken from the track the backend
 * already propagated rather than by propagating again in the browser.
 *
 * The track covers a fixed window, so `at` may fall outside it. We clamp to the
 * nearest end and say so, and the map labels a clamped marker - showing a
 * "current position" that is really 40 minutes stale without saying so would be
 * the kind of quiet lie an operator console cannot afford.
 */
export function subSatellitePoint(track: GroundTrack, at: Date): SubSatellitePoint | null {
  if (track.points.length === 0) return null;

  const target = at.getTime();
  let best = track.points[0]!;
  let bestGap = Math.abs(best.timeUtc.getTime() - target);

  for (const point of track.points) {
    const gap = Math.abs(point.timeUtc.getTime() - target);
    if (gap < bestGap) {
      best = point;
      bestGap = gap;
    }
  }

  const first = track.points[0]!.timeUtc.getTime();
  const last = track.points[track.points.length - 1]!.timeUtc.getTime();

  return {
    satellite: track.satellite,
    timeUtc: best.timeUtc,
    latDeg: best.latDeg,
    lonDeg: best.lonDeg,
    altKm: best.altKm,
    clamped: target < first || target > last,
  };
}

export function subSatellitePoints(tracks: GroundTrack[], at: Date): SubSatellitePoint[] {
  return tracks
    .map((track) => subSatellitePoint(track, at))
    .filter((p): p is SubSatellitePoint => p !== null);
}
