/**
 * The shapes the React components work with. Same information as interfaces/wire.ts,
 * but camelCase, and with timestamps already parsed into Date objects so no
 * component ever calls `new Date(...)` in a render.
 */

/** [longitude, latitude] in WGS84 degrees - deck.gl's coordinate order. */
export type Position2D = [number, number];

export interface Scene {
  id: string;
  satellite: string;
  synthetic: boolean;
  acquiredUtc: Date;
  productLevel: string;
  imagingMode: string;
  radarBand: string;
  radarCenterFrequencyGhz: number;
  polarization: string;
  lookSide: string;
  passDirection: string;
  platformHeadingDeg: number;
  incidenceAngleDeg: number;
  incidenceNearDeg: number;
  incidenceFarDeg: number;
  offNadirDeg: number;
  /** null when the product does not state a noise floor. Rendered as "--". */
  neszDb: number | null;
  orbitSource: string;
  centerLatDeg: number;
  centerLonDeg: number;
  footprint: Position2D[];
  durationS: number;
  mapProjection: string;
  resolutionAzimuthM: number;
  resolutionRangeM: number;
  /** Absent rather than empty when the product carries no note. */
  note?: string;
}

export interface Satellite {
  name: string;
  noradId: number;
  inclinationDeg: number;
  orbitFamily: string;
  tleEpochUtc: Date;
  raanDeg: number;
  eccentricity: number;
  periodMinutes: number;
  meanAltitudeKm: number;
  tleLine1: string;
  tleLine2: string;
}

export interface TrackPoint {
  timeUtc: Date;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
}

export interface GroundTrack {
  satellite: string;
  startUtc: Date;
  stepS: number;
  minutes: number;
  points: TrackPoint[];
}

/** A satellite's sub-satellite point at one instant, taken from a ground track. */
export interface SubSatellitePoint {
  satellite: string;
  timeUtc: Date;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  /** true when the requested instant falls outside the track and we clamped to an end. */
  clamped: boolean;
}

export interface Target {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
}

export interface AccessWindow {
  satellite: string;
  /** Display name; the timeline rows key on it. */
  target: string;
  /** Stable id, for filtering without matching display strings. */
  targetId: string;
  startUtc: Date;
  endUtc: Date;
  durationS: number;
  bestOffNadirDeg: number;
  /** The instant inside the window where the geometry is best. */
  bestAtUtc: Date;
  lookSide: string;
  passDirection: string;
}

export interface AccessAssumptions {
  offNadirMinDeg: number;
  offNadirMaxDeg: number;
  earthModel: string;
  frame: string;
  note: string;
}

export interface AccessHorizon {
  startUtc: Date;
  days: number;
  coarseStepS: number;
}

export interface AccessReport {
  horizon: AccessHorizon;
  assumptions: AccessAssumptions;
  targets: Target[];
  windows: AccessWindow[];
}
