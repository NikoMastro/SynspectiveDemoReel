/**
 * The JSON exactly as the Go backend sends it: snake_case, flat, no optional
 * trickery. Nothing in this file is renamed or reshaped - if the Go struct tag
 * says `off_nadir_deg`, this file says `off_nadir_deg`.
 *
 * Keeping the wire shape separate from the shape the components use means a
 * backend rename breaks in exactly one place (lib/mapping.ts) instead of
 * everywhere, and the diff against the Go structs stays readable.
 *
 * This file is the mirror of `backend/internal/adapter/wire/wire.go`, and the
 * mirror is meant to be complete. Declaring only the fields the UI happens to
 * render today is how a field ends up being fetched, paid for, and invisible:
 * every `Satellite` field beyond the name was in that state before this file
 * was squared with the Go structs. `contract_test.go` pins the names from the
 * other side.
 */

export interface WireHealth {
  status: string;
  service: string;
  version: string;
}

/** A closed footprint ring, [longitude, latitude] pairs in WGS84 degrees. */
export type WireRing = [number, number][];

export interface WireScene {
  id: string;
  satellite: string;
  /** true for catalog filler generated from the Format Manual field list. */
  synthetic: boolean;
  acquired_utc: string;
  product_level: string;
  imaging_mode: string;
  radar_band: string;
  radar_center_frequency_ghz: number;
  polarization: string;
  look_side: string;
  pass_direction: string;
  platform_heading_deg: number;
  incidence_angle_deg: number;
  incidence_near_deg: number;
  incidence_far_deg: number;
  off_nadir_deg: number;
  /** null when the delivered metadata does not state it - see the Mt. Aso scene. */
  nesz_db: number | null;
  orbit_source: string;
  center_lat_deg: number;
  center_lon_deg: number;
  footprint: WireRing;

  /** Seconds of acquisition. 1.41 s for the real Sliding Spotlight scene. */
  duration_s: number;
  /** e.g. "UTM zone 52N / WGS84". */
  map_projection: string;
  resolution_azimuth_m: number;
  resolution_range_m: number;
  /** `omitempty` on the Go side, so genuinely absent rather than empty. */
  note?: string;
}

export interface WireScenesResponse {
  count: number;
  scenes: WireScene[];
}

export interface WireSatellite {
  name: string;
  norad_id: number;
  inclination_deg: number;
  /** "near-polar" or "mid-inclination" - the two orbit families in the fleet. */
  orbit_family: string;
  tle_epoch_utc: string;

  raan_deg: number;
  eccentricity: number;
  period_minutes: number;
  mean_altitude_km: number;
  /** The element set the whole orbit is derived from, kept so it can be shown. */
  tle_line1: string;
  tle_line2: string;
}

export interface WireSatellitesResponse {
  count: number;
  satellites: WireSatellite[];
}

export interface WireTrackPoint {
  time_utc: string;
  lat_deg: number;
  lon_deg: number;
  alt_km: number;
  speed_km_s: number;
}

export interface WireGroundTrack {
  satellite: string;
  start_utc: string;
  step_s: number;
  minutes: number;
  points: WireTrackPoint[];
}

export interface WireTarget {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
}

export interface WireTargetsResponse {
  count: number;
  targets: WireTarget[];
}

export interface WireAccessWindow {
  satellite: string;
  /** Human-readable name, which the timeline rows key on. */
  target: string;
  /** Stable id, so a client can filter without matching display strings. */
  target_id: string;
  start_utc: string;
  end_utc: string;
  duration_s: number;
  best_off_nadir_deg: number;
  /** When within the window the geometry is best - the instant worth tasking. */
  best_at_utc: string;
  look_side: string;
  pass_direction: string;
}

export interface WireAccessAssumptions {
  off_nadir_min_deg: number;
  off_nadir_max_deg: number;
  earth_model: string;
  frame: string;
  note: string;
}

export interface WireAccessHorizon {
  start_utc: string;
  days: number;
  coarse_step_s: number;
}

export interface WireAccessResponse {
  horizon: WireAccessHorizon;
  assumptions: WireAccessAssumptions;
  targets: WireTarget[];
  windows: WireAccessWindow[];
}
